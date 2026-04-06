---
author/creator:
created: 2026-02-16
tags:
---
# Project Title

Using the Question Formulation Technique to Recover the Unclear Question: Designing a Question Coach for Productive Cognitive Friction

# Rationale

UNESCO has identified the "[disappearance of the unclear question](https://www.unesco.org/en/articles/disappearance-unclear-question)" as a significant concern in contemporary education. The disappearance stems from students' increasing reliance on AI tools to bypass the difficult cognitive work of question formulation (Livingstone & Stricker, 2025). This project matters to us because we recognize that question formulation, the process through which students work from vague uncertainty to focused inquiry is i) foundational to academic success across disciplines (Summers et al., 2024), ii) largely unaddressed in post-secondary education (Summers et al., 2024), and iii) as noted above, now easily bypassed through the use of AI.

Our approach to addressing this problem is to intervene at the precise moment when students typically reach for AI assistance. Rather than prohibiting AI use, we plan to design a prompt that can be used to turn any AI chatbot into a Socratic question formulation coach. To accompany this we will design a set of physical cards that break up the AI interaction by having students draw a card and respond to the question or prompt on it at multiple points in the process. Instead of treating AI as a tool to fully automate learning tasks, our project aims to model an ethical middle ground in which AI is used for scaffolding rather than substitution. Our Question Coach will position AI as a facilitator of metacognitive development.

This project represents our attempt to reclaim question formulation as a site of genuine learning rather than a task to be outsourced. This approach supports using AI to cultivate intellectual autonomy instead of dependency.

# Cognitive Friction as a Learning Mechanism

Educational psychology suggests that durable learning, in fact, emerges from desirable difficulty instead of fluency (Bjork & Bjork, 2011). Whenever learners encounter uncertainty, they engage in metacognitive monitoring, error detection, then strategy revision. These processes are the basics of inquiry-based learning.

Rather than eliminating uncertainty, Question Coach introduces structured friction in the question formulation process by scaffolding productive engagement. This system supports learners in transforming unclear thinking into articulated inquiry.

# Project Description

The Question Coach is a three-component learning tool designed to help college students develop and improve their question formulation skills. The components of the system are:

**Socratic Coaching AI Prompt:** A detailed structured markdown prompt that instructs an LLM (e.g. Claude, ChatGPT, Gemini) to be a Question Coach that guides students through the steps of the [[Question Formulation Technique (QFT)]] (Rothstein & Santana, 2011). The Question Coach guides students through the QFT process, tells them when to draw prompt cards (see below), and encourages reflection on question quality.

**Prompt Cards:** Two decks of cards that create strategic interruptions in the AI conversation. Students draw a card at Step 2 (Produce Questions) and Step 4 (Prioritize Questions). In both cases, the card interrupts the student’s engagement with the AI and nudges them to reflect, articulate their thinking in writing or diagrams, compare multiple question formulations, or explain their reasoning to a peer. These cards are intentionally analog to create productive friction that digital-only interactions cannot provide.

**Knowledge Base:** A companion resource that explains the QFT framework, the purpose of the card intervention, how to go through the Question Coach process, and the pedagogical rationale for the system's design.

The tool is designed for college students across disciplines who are working on research projects, literature reviews, or complex problem-solving tasks where question quality directly impacts outcome quality. Rather than optimizing for speed or ease, Question Coach optimizes for question improvement, which is measured through the student's self-assessment in the final Reflect step of the QFT process, where they are asked what they learned, how they can use what they learned, and whether they see an improvement in the specificity, clarity, and depth of their questions.

The ultimate success of Question Coach is not ‘continued dependence’ on the tool, but the internalisation of question formulation practices. It is designed as temporary scaffolding that ‘fades’ as learners develop independent inquiry skills.

**Example Use Scenario:**

# Intended Uses and Users

## 1. Primary Users

College students engaged in open-ended inquiry tasks where initial questions are often vague, broad, or poorly articulated. These users are familiar with AI tools and likely already using them for academic work, but lack systematic approaches to improving their questions before seeking answers.

## 2. Intended Use Context

Students use Question Coach at the beginning of research or inquiry processes when they have a topic area but haven't yet formulated clear research questions. The tool is designed for 30-45 minute sessions where students work through all the steps of the QFT process. 

# How the Tool Configures Its Users

Question Coach configures its users in the following ways:

**Defining User Identity:** The tool presumes users are students who benefit from struggling with question formulation. It treats uncertainty and confusion as productive states rather than problems to be eliminated. It configures users as apprentices in a discipline-specific practice rather than consumers seeking information.

**Setting Constraints on Actions:** The physical cards create mandatory pauses where users must take a break from the AI interaction. Users must complete card prompts before proceeding. This constraint assumes users need to learn to interrupt the ease and fluency of AI interactions. 

**Assumptions About Competence:** The tool assumes users can improve their question formulation skills with scaffolding but are unlikely to do so without intervention. It presumes basic literacy and metacognitive capacity while simultaneously assuming that left to their own devices, users will default to the cognitive shortcut of using AI, undermining their learning.

**Configuring Future Actions:** By taking users through the QFT process in a way that breaks the momentum of AI-assisted answer-seeking, the tool aims to help users internalize an effective question formulation process, thereby configuring users who eventually won't need the scaffolding when engaging in research or personal curiosity.  

# Definition of Usability

Educational usability differs from general usability because learning often requires complication rather than simplification. Question improvement requires confronting one's unclear thinking, which is an uncomfortable process. Educational usability means scaffolding this discomfort rather than eliminating it. Question Coach challenges conventional usability principles that equate usability with efficiency, ease, and minimal user effort. In HCI terms, our tool is deliberately not optimized because it requires more time and impedes the path of least resistance to task completion.

However, we argue that this friction is our usability design. The tool is usable for its intended purpose (developing question formulation skills) precisely because it resists being usable for getting quick answers and outsourcing cognitive work.

Question Coach demonstrates Woolgar’s idea of user configuration by deliberately guiding learners toward reflection rather than efficiency-driven interaction. Our system visualises configuration, allowing users to understand how design constraints shape and influence their actions.

## Our definition of Usability follows these principles

**Transparency of Constraints:** Users understand why the friction exists through the instructions/knowledge base. This component of the tool signals its own configuration work.

**Graduated Challenge:** The QFT stages introduce difficulty gradually. Early stages accept vague or simplistic questions, later stages demand refinement. This creates “low floors” (any student with a vague topic can begin), “wide walls” (QFT works across disciplines), and “high ceilings” (deep questioning remains challenging) (Resnick & Silverman, 2005).

**Meaningful Resistance:** Every friction point serves a pedagogical function. We distinguish between productive friction (card prompts that deepen thinking) and accidental friction (confusing interface, unclear instructions).

**Learner Agency:** Unlike tools that configure users toward predetermined "correct" questions, Question Coach supports divergent questioning. Students retain ownership of their inquiry direction while developing the metacognitive tools to improve their formulations.

# Usability Specifications

Following the Usability Specifications model in Usability and HCI (Issa & Isaias, 2015, p.33), we propose the following performance and preference measures: 

## Performance Measures

**Completion Rate:** Percentage of students who complete all QFT stages in a session
**Question Improvement Score:** Comparing initial and final questions on dimensions of specificity, clarity, and depth (rated by independent raters)
**Card Engagement Rate:** Percentage of card prompts acted upon vs. skipped

## Preference Measures

**Perceived Value:** "The friction in this tool helped me develop better questions" (5-point Likert)
**Frustration vs. Productivity:** Post-session interviews exploring whether friction felt purposeful or arbitrary
**Willingness to Recommend:** "I would recommend this tool to peers working on similar projects"

# Anticipated Failure Modes

There are several ways we anticipate the system may fail or be resisted:
- Users may attempt to bypass card prompts
- Users may try to ‘force’ the AI coach to provide answers
- Friction may be perceived as arbitrary rather than purposeful

To mitigate these anticipated issues, we will strengthen the system via intentional design safeguards:
- We will ensure the knowledge base clearly communicates the purpose of productive friction to help users understand why constraints are part of the learning process
- We will ensure the AI coach redirects attempts to bypass stages while preserving learner agency
- We will collect insights from usability walkthroughs in order to guide refinements

# References

Bjork, E. L., & Bjork, R. A. (2011). [[Making Things Hard on Yourself, But in a Good Way. Creating Desirable Difficulties to Enhance Learning]]. In M. A. Gernsbacher, R. W. Pew, L. M. Hough, & J. R. Pomerantz (Eds.), Psychology and the real world: Essays illustrating fundamental contributions to society (pp. 56–64). Worth Publishers. 

Issa, T., & Isaias, P. (2015). [[Usability and human computer interaction (HCI)]] (pp. 19–36). Springer. https://doi.org/10.1007/978-1-4471-6753-2_2

Livingstone, V., & Stricker, J. K. (2025, October 27). [[The disappearance of the unclear question]]. UNESCO. https://www.unesco.org/en/articles/disappearance-unclear-question

Resnick, M., & Silverman, B. (2005). [[Some reflections on designing construction kits for kids]]. In M. Eisenberg & A. Eisenberg (Eds.), Proceedings of the 2005 conference on Interaction design and children (pp. 117–122). Association for Computing Machinery. https://doi.org/10.1145/1109540.1109556

Rothstein, D., & Santana, L. (2011). [[Teaching students to ask their own questions. One small change can yield big results]]. Harvard Education Letter, 27(5). http://www.hepg.org/hel/printarticle/507

Summers, M., Fernandez, J., Handy-Hart, C.-J., Kulle, S., & Flanagan, K. (2024). [[Undergraduate students develop questioning, creativity, and collaboration skills by using the Question Formulation Technique]]. The Canadian Journal for the Scholarship of Teaching and Learning, 15(2). https://doi.org/10.5206/cjsotlrcacea.2024.2.15519

Woolgar, S. (1990). [[Configuring the user. The case of usability trials]]. Sociological Review, 38(1, Suppl.), S58–S99. https://doi.org/10.1111/j.1467-954X.1990.tb03349.x
