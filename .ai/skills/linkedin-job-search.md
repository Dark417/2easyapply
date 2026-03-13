---
name: linkedin-job-search
description: When the user says "lk search", open Chrome tabs to search for specific software engineer jobs on LinkedIn with the Easy Apply filter.
---
# LinkedIn Job Search Skill

Run this skill when the user says "lk search".

## Instructions
1. Ensure the debug Chrome instance is running on port 9222.
2. Run the following command in the terminal to immediately open 3 search tabs via the CDP JSON API:
```bash
python -c "import urllib.request; [urllib.request.urlopen(urllib.request.Request('http://localhost:9222/json/new?https://www.linkedin.com/jobs/search/?keywords=software%20engineer%26location=' + loc + '%26f_AL=true', method='PUT')) for loc in ['san%20francisco', 'san%20jose', 'seattle']]"
```
3. These URLs map to:
   - "software engineer san francisco" filter: Easy Apply
   - "software engineer san jose" filter: Easy Apply
   - "software engineer seattle" filter: Easy Apply

