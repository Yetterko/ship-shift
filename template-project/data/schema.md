# Rosterette data

## data/staff.json

An array of staff members.

| Field | Type | Example | Meaning |
| --- | --- | --- | --- |
| `id` | string | `"s1"` | Unique staff id |
| `name` | string | `"Ana"` | Shown in the first column of the roster |

## data/shifts.json

An array of shifts for one week.

| Field | Type | Example | Meaning |
| --- | --- | --- | --- |
| `id` | string | `"sh1"` | Unique shift id; roster cells carry it as `data-shift` |
| `staffId` | string | `"s1"` | The staff member working it; must match a `staff.json` id |
| `day` | string | `"Mon"` | One of `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, `Sun` |
| `start` | string | `"09:00"` | 24-hour start time |
| `end` | string | `"15:00"` | 24-hour end time, later than `start` on the same day |
