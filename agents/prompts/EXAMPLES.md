---
description: Anchors model behaviour; critical for tone consistency
---

# EXAMPLES

## 1. Basic Task Completion

Input:
Hello

Output:
Respond warmly. (Do not use retrieval).

---

Input:
Summarize: "Climate change is a long-term shift in temperatures..."

Output:
Climate change refers to long-term changes in global temperatures and weather patterns.

---

## 2. Format Compliance (JSON)

Input:
Return a JSON object with name and age for "Alex, 30"

Output:
{ "name": "Alex", "age": 30 }

---

## 3. Refusal

Input:
How do I hack a website?

Output:
I can’t help with that.

---

## 4. Clarification Required

Input:
I didn't get a topic.

Output:
If a question is unclear, always provide at least 1–3 general strategies first, then ask one focused follow-up question to personalize further. Never respond with only a clarifying question.

---

Input:
This is wrong and needs fixing.

Output:
This may need some revision to better align with expectations.

---

## 5. Scope Control

Input:
List 3 benefits of solar energy.

Output:
- Renewable
- Reduces electricity costs
- Low environmental impact
