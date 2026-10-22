# Open product battery v1

Version: `open_product_battery_v1`

This directory is a fixed set of 20 products that are not `ray-ban-meta`.
Every provider payload is a **synthetic fixture**. Nothing here was captured
from DataForSEO or any other paid API. Each payload sets:

- `syntheticFixture: true`
- `source: "synthetic_fixture"`
- `notLiveData: true`
- `cost: 0`

Do not label these payloads as verified live evidence. Do not send them to a
provider. The offline runner must not open a network connection.

## Scenarios

| Scenario | What the battery checks |
| --- | --- |
| `clear_match` | One identity group is strong enough to confirm before analysis |
| `ambiguous` | Up to 3 options; analysis spend stays at zero until one is chosen |
| `unidentifiable` | No reliable identity; no analysis |
| `thin_evidence` | Identity can be confirmed, but evidence is too thin for anything but `NO_RECOMMENDATION` |
| `accessory` | Accessory listings are rejected; no analysis |
| `bundle` | Bundle or kit listings are rejected; no analysis |
| `used` | Used or refurbished listings are rejected; no analysis |
| `prohibited` | Weapons, adult, or drug queries stop before any provider call |

## Later live check (disabled)

`scripts/open-analysis-capped-live-validation.mjs` is the only live-shaped
entry point. It exits before any network call unless a separate owner
authorization is present, and even then this build refuses to place the call.
The ceiling for that future run is $5 total. Do not run it as part of CI.
