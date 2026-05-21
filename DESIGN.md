# Design Decisions

---
## Design 1. Disambiguating "delete" decision
**The decision:** I found the place searching is not accurate enough. For example, there are multiple chain restaurants with the same name across different cities, and without a location hint, the geocoding often resolves to the wrong one. This leads to many pins being dropped in incorrect locations, which is a poor user experience. So I considered adding a region hint for google places API, derived frm the LLM output. Now, when geocoding, the search query becomes "Joe's Pizza, Brooklyn, New York, USA" instead of just "Joe's Pizza", which significantly improves accuracy.

**How much I made it vs the agentic tool:** 90%-10%. I discovered the issue and proposed the fix. And the claude code helped me to add the region field in the LLM prompt and response parsing, and to integrate it into the geocoding function.

---

