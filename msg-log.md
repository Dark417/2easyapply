| Time | User Input | Response |
|------|------------|----------|
| 260427-23:08 | Replace Abby icon with provided red monster artwork | Replaced Abby logo/icon assets with generated PNG variants based on the provided artwork and validated extension assets. |
| 260317-05:39 | at end of each response, return updated abby version | Updated `agents.md` so every final response must append the current Abby version from `abby/manifest.json`. |
| 260317-05:38 | regex: *work*on*site, Yes / regex: How did you hear about us? | Updated canonical regex handling so `How did you hear about us?` maps to Abby's shared "How did you learn about this role?" answer; confirmed `*work*on*site` should be entered as a custom regex pattern, not as a built-in canonical key. |
| 260315-11:54 | chrome check profiles | Checked local Chrome profiles and returned detected profile directories. |
| 260228-16:04 | Create easyapply Chrome plugin spec and research Simplify extension | Update task.md. Researching Simplify extension features to draft MVP spec in /design. |
| 260228-14:54 | Add standard response format to agents.md | Updated `agents.md` with standard "What you wanted", "What I have done", "What failed", and "Recommended actions" layout. |
| 260228-14:50 | Setup new 2easyapply project with agent structure | Created README, agents.md, and .ai/ folder with lead-architect agent, update-agents skill, and chat-log skill. Initialized git and github repo exactly as requested. |

- 03-13 05:47 - Implemented auto/manual apply mode, modal focus lock, regex injection, delay ranges list, CSV export, and popup counters.
