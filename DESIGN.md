# Design Decisions

---
## Design 1. Place Searching w/o Region Hint
**The decision:** I found the place searching is not accurate enough. For example, there are multiple chain restaurants with the same name across different cities, and without a location hint, the geocoding often resolves to the wrong one. This leads to many pins being dropped in incorrect locations, which is a poor user experience. So I considered adding a region hint for google places API, derived frm the LLM output. Now, when geocoding, the search query becomes "Joe's Pizza, Brooklyn, New York, USA" instead of just "Joe's Pizza", which significantly improves accuracy.

**How much I made it vs the agentic tool:** 90%-10%. I discovered the issue and proposed the fix. And the claude code helped me to add the region field in the LLM prompt and response parsing, and to integrate it into the geocoding function.

---

## Design 2. Export list as `.kml` vs. Imitate Click and Save in Google Maps
**The decision:** I initially thought it is impossible to save list directly into Google Maps, so I implemented a feature for users to export their list as a `.kml` file. But I found Google Map doesn't support kml file import either. The only supported map is MyMap for developers. But it is not convenient for users. After some research, I found that the agent can mimic the user behavior of mouse clicking to create a list in Google Maps, search for each location and add it to the saved list. So I implemented the feature to imitate click and save in Google Maps, which requires zero effort from users and provides a seamless experience.

**How much I made it vs the agentic tool:** 70%-30%. I discovered the issue, conducted the research, and proposed the fix. But the claude code helped me to implement the feature of imitating click and save in Google Maps, which is a complex task that involves simulating user interactions with the web interface.