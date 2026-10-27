# DeskTwin

DeskTwin is a proposed personal workspace agent: it helps users map the devices on their desk from a photo, describe their connections through conversation, and troubleshoot a specific problem with user-guided checks.

This repository is a starting point for the Meta Global AI Developer Hackathon. The product and integrations have not been implemented yet.

## Proposed demo

1. Upload a desk photo and identify visible devices and their approximate positions. Let the user correct the results.
2. Build a device connection graph through conversation and explicit user confirmation.
3. Ask about a problem, inspect the confirmed graph, and suggest a next troubleshooting check. Update the diagnosis based on the user's answer.

A photo or a user's description does not establish whether a cable is actually connected or whether a device is working. Keep reported topology, AI suggestions, and independently verified status distinct. OS-based detection is a possible later extension, not part of the initial demo.

## Meta integration

Use a Meta model for meaningful product functionality, such as interpreting a desk photo and conducting the device-connection conversation. The exact models, API mode, architecture, and scope remain to be selected and verified. See [Meta Model API Quickstart](https://dev.meta.ai/docs/quickstart).

## Getting started

There is no runnable application yet. First confirm the $150 credit has appeared in Meta Model API Billing, configure billing as required, and create an API key. Keep keys out of Git and screenshots. The API's spending alert is not a hard cap.

See [the project brief](docs/PROJECT.md) for the current idea and [the hackathon checklist](docs/HACKATHON.md) for submission requirements and next steps.
