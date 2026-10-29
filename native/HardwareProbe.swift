// A read-only, one-shot native probe. Invoked only after local UI consent.
// The server passes an installation-specific HMAC key on stdin, never in argv.
// Raw serial numbers stay in this process; only keyed digests cross stdout.
import AppKit
import CoreGraphics
import CryptoKit
import Foundation
import IOKit

struct CategoryResult: Codable {
    let state: String
    let source: String
    let message: String
}
struct Attribute: Codable {
    let label: String
    let value: String
}
struct DeviceResult: Codable {
    let id: String
    let category: String
    let name: String
    let model: String
    let fingerprint: String?
    let source: String
    let status: String
    let parentId: String?
    let attributes: [Attribute]
}
struct ProbeResult: Codable {
    let schemaVersion: Int
    let categories: [String: CategoryResult]
    let devices: [DeviceResult]
}

func bounded(_ value: String, _ length: Int = 160) -> String {
    String(value.components(separatedBy: .controlCharacters).joined().prefix(length))
}
func digest(_ value: String, key: SymmetricKey) -> String {
    HMAC<SHA256>.authenticationCode(for: Data(value.utf8), using: key)
        .map { String(format: "%02x", $0) }.joined()
}
func usableSerial(_ value: String?) -> String? {
    guard let serial = value?.trimmingCharacters(in: .whitespacesAndNewlines),
          !serial.isEmpty, serial.count <= 512,
          !["0", "unknown", "none", "null", "n/a", "not available", "not specified", "default", "serial number"].contains(serial.lowercased()),
          serial.contains(where: { $0 != "0" && !$0.isWhitespace }),
          !serial.allSatisfy({ $0 == "F" || $0 == "f" }) else { return nil }
    return serial
}

@MainActor
func displays(key: SymmetricKey) -> (CategoryResult, [DeviceResult]) {
    let source = "macOS CoreGraphics + AppKit NSScreen"
    var count: UInt32 = 0
    guard CGGetOnlineDisplayList(0, nil, &count) == .success, count <= 256 else {
        return (CategoryResult(state: "error", source: source,
            message: "CoreGraphics could not enumerate online displays."), [])
    }
    // Extra capacity handles an addition between the two native calls.
    var ids = [CGDirectDisplayID](repeating: 0, count: 256)
    guard CGGetOnlineDisplayList(UInt32(ids.count), &ids, &count) == .success else {
        return (CategoryResult(state: "error", source: source,
            message: "The display list changed while it was being read. Try again."), [])
    }
    // NSScreen requires an application connection to the window server. This
    // read-only helper creates no windows and never runs an application loop.
    _ = NSApplication.shared
    var names: [CGDirectDisplayID: String] = [:]
    for screen in NSScreen.screens {
        if let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
            let name = bounded(screen.localizedName).trimmingCharacters(in: .whitespacesAndNewlines)
            if !name.isEmpty { names[number.uint32Value] = name }
        }
    }
    let devices = ids.prefix(Int(count)).map { id -> DeviceResult in
        let vendor = CGDisplayVendorNumber(id)
        let model = CGDisplayModelNumber(id)
        let serial = CGDisplaySerialNumber(id)
        let builtin = CGDisplayIsBuiltin(id) != 0
        // CoreGraphics uses 0 for a missing serial and UInt32.max when no
        // monitor is associated. Neither value can identify real hardware.
        let fingerprint = serial != 0 && serial != UInt32.max
            && vendor != 0 && vendor != UInt32.max && model != 0 && model != UInt32.max
            ? digest("display:\(vendor):\(model):\(serial)", key: key) : nil
        let mirrored = CGDisplayIsInMirrorSet(id) != 0
        let asleep = CGDisplayIsAsleep(id) != 0
        let active = CGDisplayIsActive(id) != 0
        let attributes = [
            Attribute(label: "Online", value: "Yes"),
            Attribute(label: "Active for drawing", value: active ? "Yes" : "No"),
            Attribute(label: "Sleeping", value: asleep ? "Yes" : "No"),
            Attribute(label: "Mirrored", value: mirrored ? "Yes" : "No"),
            Attribute(label: "Built-in", value: builtin ? "Yes" : "No"),
            Attribute(label: "Pixel size", value: "\(CGDisplayPixelsWide(id)) × \(CGDisplayPixelsHigh(id))"),
        ]
        return DeviceResult(id: "display-\(id)", category: "display",
            name: names[id] ?? (builtin ? "Built-in display" : "Display (name unavailable)"),
            model: "Vendor \(vendor) / Model \(model)", fingerprint: fingerprint,
            source: source, status: "online", parentId: nil, attributes: attributes)
    }
    var finalCount: UInt32 = 0
    guard CGGetOnlineDisplayList(0, nil, &finalCount) == .success,
          finalCount == count,
          ids.prefix(Int(count)).allSatisfy({ CGDisplayIsOnline($0) != 0 }) else {
        return (CategoryResult(state: "error", source: source,
            message: "The display list changed while it was being read. Presence is unknown until the next successful check."), [])
    }
    return (CategoryResult(state: "ok", source: source,
        message: "Online displays include active, mirrored and sleeping displays. Recognition does not prove image output works."), devices)
}

func registryID(_ entry: io_registry_entry_t) -> UInt64? {
    var value: UInt64 = 0
    return IORegistryEntryGetRegistryEntryID(entry, &value) == KERN_SUCCESS ? value : nil
}
func usbParent(_ entry: io_registry_entry_t) -> String? {
    var current = entry
    var ownsCurrent = false
    // IOService contains interface/controller entries between physical USB devices.
    // Report only the nearest ancestor that is itself a USB device.
    for _ in 0..<64 {
        var parent: io_registry_entry_t = 0
        let result = IORegistryEntryGetParentEntry(current, kIOServicePlane, &parent)
        if ownsCurrent { IOObjectRelease(current) }
        if result != KERN_SUCCESS { return nil }
        if IOObjectConformsTo(parent, "IOUSBHostDevice") != 0 || IOObjectConformsTo(parent, "IOUSBDevice") != 0 {
            let id = registryID(parent)
            IOObjectRelease(parent)
            return id.map { "usb-\($0)" }
        }
        current = parent
        ownsCurrent = true
    }
    if ownsCurrent { IOObjectRelease(current) }
    return nil
}
func usb(key: SymmetricKey) -> (CategoryResult, [DeviceResult]) {
    let source = "macOS IOKit IOService USB registry"
    var devices: [DeviceResult] = []
    var seen = Set<UInt64>()
    for className in ["IOUSBHostDevice", "IOUSBDevice"] {
        var iterator: io_iterator_t = 0
        guard let matching = IOServiceMatching(className) else {
            return (CategoryResult(state: "error", source: source,
                message: "IOKit could not create the USB query."), [])
        }
        let result = IOServiceGetMatchingServices(kIOMainPortDefault, matching, &iterator)
        guard result == KERN_SUCCESS else {
            let denied = result == kIOReturnNotPermitted || result == kIOReturnNotPrivileged
            return (CategoryResult(state: denied ? "permission-denied" : "error", source: source,
                message: denied ? "macOS denied access to USB registry metadata." : "IOKit could not enumerate USB devices."), [])
        }
        defer { IOObjectRelease(iterator) }
        while true {
            let entry = IOIteratorNext(iterator)
            if entry == 0 { break }
            defer { IOObjectRelease(entry) }
            guard let entryID = registryID(entry) else {
                return (CategoryResult(state: "error", source: source,
                    message: "A USB registry entry changed during the read. Presence is unknown until the next successful check."), [])
            }
            if seen.contains(entryID) { continue }
            seen.insert(entryID)
            if devices.count >= 256 {
                return (CategoryResult(state: "error", source: source,
                    message: "USB enumeration exceeded the safety limit; absence cannot be determined."), [])
            }
            // Read a single property-table snapshot so a denied or failed read
            // cannot silently become a successful empty/partially identified scan.
            var rawProperties: Unmanaged<CFMutableDictionary>?
            let propertyResult = IORegistryEntryCreateCFProperties(entry, &rawProperties, kCFAllocatorDefault, 0)
            guard propertyResult == KERN_SUCCESS, let retainedProperties = rawProperties else {
                let denied = propertyResult == kIOReturnNotPermitted || propertyResult == kIOReturnNotPrivileged
                return (CategoryResult(state: denied ? "permission-denied" : "error", source: source,
                    message: denied ? "macOS denied access to USB registry metadata." : "USB metadata changed or could not be read. Presence is unknown."), [])
            }
            let properties = retainedProperties.takeRetainedValue() as NSDictionary
            let vendor = (properties["idVendor"] as? NSNumber)?.uint32Value ?? 0
            let product = (properties["idProduct"] as? NSNumber)?.uint32Value ?? 0
            let deviceClass = (properties["bDeviceClass"] as? NSNumber)?.uint32Value ?? 0
            let serial = usableSerial(properties["USB Serial Number"] as? String)
            let fingerprint = vendor != 0 && product != 0
                ? serial.map { digest("usb:\(vendor):\(product):\($0)", key: key) } : nil
            let manufacturer = bounded(properties["USB Vendor Name"] as? String ?? "Unavailable")
            let label = bounded(properties["USB Product Name"] as? String ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let name = label.isEmpty ? (deviceClass == 9 ? "USB hub" : "USB device (name unavailable)") : label
            devices.append(DeviceResult(id: "usb-\(entryID)", category: "usb", name: name,
                model: String(format: "USB %04x:%04x", vendor, product), fingerprint: fingerprint,
                source: source, status: "connected", parentId: usbParent(entry), attributes: [
                    Attribute(label: "Manufacturer", value: manufacturer),
                    Attribute(label: "USB class", value: deviceClass == 9 ? "Hub (9)" : String(deviceClass)),
                    Attribute(label: "Hierarchy source", value: "IOKit IOService nearest USB ancestor"),
                ]))
        }
        // IOKit can invalidate an iterator during hot-plug. A partial scan must
        // never be used to say an approved device is not detected.
        guard IOIteratorIsValid(iterator) != 0 else {
            return (CategoryResult(state: "error", source: source,
                message: "The USB list changed while it was being read. Presence is unknown until the next successful check."), [])
        }
    }
    return (CategoryResult(state: "ok", source: source,
        message: "USB registry entries and their USB ancestors only. A dock may expose several devices; display cable routing is unknown."), devices)
}

@main
struct HardwareProbe {
    @MainActor
    static func main() {
        guard CommandLine.arguments.count == 1,
              let line = readLine(), line.count <= 128,
              let data = Data(base64Encoded: line), data.count == 32 else {
            FileHandle.standardError.write(Data("DeskTwin probe requires its local bridge.\n".utf8))
            exit(2)
        }
        let key = SymmetricKey(data: data)
        let displayResult = displays(key: key)
        let usbResult = usb(key: key)
        let result = ProbeResult(schemaVersion: 1, categories: [
            "display": displayResult.0,
            "usb": usbResult.0,
            "bluetooth": CategoryResult(state: "unavailable", source: "Not collected",
                message: "Bluetooth detection is not implemented in this native helper. Recorded Bluetooth links remain user reports."),
        ], devices: displayResult.1 + usbResult.1)
        do {
            let output = try JSONEncoder().encode(result)
            FileHandle.standardOutput.write(output)
        } catch {
            FileHandle.standardError.write(Data("DeskTwin probe could not encode its result.\n".utf8))
            exit(3)
        }
    }
}
