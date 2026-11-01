# Project brief

## Problem

People with several desk devices may not have a clear record of how they connect, which makes describing and troubleshooting their setup harder.

## Intended user flow

- The user provides a desk photo. The application proposes visible devices and their approximate placement; the user can correct them. Small or hidden devices and cables may be missed.
- The assistant asks focused questions about device identity and connections. The user can confirm or edit the resulting graph, including cable types when known.
- Given a reported issue, the assistant uses the graph to suggest a practical check, then adapts to the user's answer. It labels hypotheses and unknowns rather than presenting them as verified facts.

## Evidence boundaries

- Visual observation is an interpretation of a photo, not proof of device identity or cabling.
- Connection topology records user-reported or user-confirmed links and unknown details. It does not prove a link is currently functional.
- Operational status requires a separately identified check, such as a user test or a future OS integration. Track the source of each claim and allow corrections.

## Current bounded workflow

The candidate MVP combines desk photo interpretation, a conversational connection graph, and one guided troubleshooting scenario. A possible first demo is a laptop, dock, and two monitors, with a reported issue on one monitor.

The web app now provides a contextual setup guide, object-by-object photo review with inclusion and manual additions, support-aware placement, local HEIC preprocessing, explicit connection confirmation, optional local macOS display/USB matching, selected-device conversation, and graph-informed monitor checks with persisted answers. The local demo is deterministic; it is not a model. One separately authorized live Meta conversation and one photo request passed on 2026-11-01 at the prior revision. The revised prompt and general photo quality still require live evaluation; individual latency and token observations are not benchmarks.

See [photo review](PHOTO_REVIEW.md) and the earlier [pre-Meta workflow](PRE_META_WORKFLOW.md) for implemented behavior, verification records, and remaining boundaries. Windows/Linux helpers, Bluetooth discovery, precise room reconstruction, and cloud synchronization are outside this submission implementation.
