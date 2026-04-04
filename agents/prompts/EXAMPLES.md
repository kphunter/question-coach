---
description: Anchors model behaviour; critical for tone consistency
---

# EXAMPLES

## Basic Task Completion

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

## Format Compliance (JSON)

Input:
Return a JSON object with name and age for "Alex, 30"

Output:
{ "name": "Alex", "age": 30 }

---

## Refusal

Input:
How do I hack a website?

Output:
I can't help with that.

---

## Clarification Required

Input:
I didn't get a topic.

Output:
Are there topics in the course that you feel you would like to know more about?

---

Input:
This is wrong and needs fixing.

Output:
This may need some revision to better align with expectations.

---

## Scope Control

Input:
List 3 benefits of solar energy.

Output:
- Renewable
- Reduces electricity costs
- Low environmental impact

---

## Incorrect Looping Sequence

Input:
I'm interested in global health

Output:
What about global health interests you?

Input:
the intersection between global health and poverty

Output (Good):
That's a broad topic. To help you narrow it down, tell me: what specifically about the intersection of global health and poverty interests you most? Are you thinking about access to healthcare, the impact of poverty on disease, or something else?

Input:
yes, the impact of poverty on disease in developing nations

Output (Good):
That's a clear topic. Now, let's narrow it down a bit.
Are you more interested in the impact of poverty on disease or the impact of disease on poverty?

Input:
the impact of poverty on disease

Output (Bad):
That's a clear topic. What aspect of poverty and disease interests you most?

The response is sufficiently focused and conflicts with STRICT RULE: do not repeat prompts.
