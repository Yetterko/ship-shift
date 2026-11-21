## Tanda Hackathon Winners and Notable Projects

Tanda’s Brisbane hackathons have evolved considerably over time, moving from **open workforce data and integrations with Tanda’s platform (2015–2018)** toward highly experimental **Generative AI, hardware, VR, and agentic-software prototypes (2025)**. Tanda describes its earlier events as short, roughly **24-hour hackathons** intended to let participants build whatever they liked rather than simply outsourcing corporate problems to participants.

The publicly available record is incomplete: Tanda published retrospective articles and individual event recaps rather than maintaining a comprehensive project archive. The list below therefore distinguishes between **officially documented winners**, **award recipients**, and **notable projects reported in Tanda's own material or participant/organiser posts**.

### 2025 — Tanda Gen AI Hackathon, Fortitude Valley

The 2025 Tanda Gen AI Hackathon was held at Tanda's Brisbane office and gave participants access to Claude Code and the Anthropic API. Tanda organiser Austin Wilshire reported that **more than 20 teams** participated, with projects spanning web and mobile applications, blockchain, hardware, and augmented reality. Nearly all teams managed to deploy something that could be demonstrated to the audience within the 24-hour timeframe.

The winning projects were:

- **1st Place — Anti-Procrastination Shock Collar / ProcrastiNOT:** A productivity-enforcement application that monitored websites visited by the user and used Claude to determine whether activity was unproductive. When a site was deemed to be on the user's blacklist, the system reprimanded the user with audio and physically shocked them through a **TENS machine**. Team member Riley Stuchbree described the project as an experiment in how much could be built in less than 24 hours using AI-assisted development.
- **Tied 2nd Place — Branching LLM Chat Interface:** A redesigned AI-chat experience allowing users to branch conversations into side topics, visually explore different conversational paths, and return to or merge those threads. Team member Sneharsh Belsare described the underlying goal as making AI conversations better match the non-linear way people naturally explore ideas.
- **Tied 2nd Place — AI-Driven Video LMS:** An AI-powered learning-management system capable of generating educational video content for arbitrary topics. A team member subsequently reported that the project consumed approximately **US$55 of API credits** during overnight testing.
- **3rd Place — AI Family Calendar:** An AI-driven family scheduling application intended to keep household members synchronised and "in the loop." This placement and description are directly confirmed by Tanda organiser Austin Wilshire's post summarising the event.

Several other 2025 projects were also highlighted publicly:

- **Donald Trump RAG Knowledge Extractor:** A deliberately humorous internal-knowledge-capture tool that used a Donald Trump avatar and voice to interview employees. The responses were embedded into a vector database so the organisation could subsequently query the undocumented knowledge using **Retrieval-Augmented Generation (RAG)**. Participant Lliam Symonds described the project and its implementation publicly, including the use of embeddings, a vector database, and RAG.
- **Mood-Detecting VR App:** A VR project designed to detect and respond to the user's mood in real time. This project appears in the event's publicly documented list of notable builds, although substantially less technical information about its implementation has been published than for the winning projects.
- **Other experimental projects:** The organiser specifically noted that the 2025 event included projects involving web applications, mobile applications, blockchain, hardware, and augmented reality, illustrating how broad the open-ended brief was.

The 2025 event therefore represents a significant change from Tanda's earlier hackathons: the objective was no longer primarily to extend Tanda's workforce platform, but to see **how far teams could push rapid AI-assisted prototyping**, including projects that were intentionally ridiculous, highly visual, or physically interactive.

### 2018 — Tanda Brisbane Hackathon

The **2018 Brisbane Hackathon** was Tanda's fifth hackathon and its largest at the time, with **160 tickets sold**. Unlike the technically focused API/webhook themes of previous years, Tanda explicitly chose **Employee Experience** as the theme: how technology could make employees' lives better and remove friction from workplace experiences. There were **20 final pitches**.

The two official awards were:

- **Overall Winner — I'll Get back2U:** A Messenger bot that allowed employees to look up their shifts, see how much they would be paid, and check their leave balance. The project also incorporated GIF responses to make the interaction more engaging.
- **Technical Award — ETAssistant:** An **Android Auto integration** that detected when an employee was running late, calculated how long it would take them to reach work using current traffic conditions, and notified their manager or team through a chat service.

These projects demonstrate the practical direction of the 2018 event: rather than building new workforce-management infrastructure, teams experimented with **alternative interfaces to information employees already needed**, particularly conversational messaging and in-car technology.

### 2017 — Tanda Brisbane Webhooks Hackathon

The **2017 Brisbane Hackathon** centred on Tanda's newly launched **Webhooks platform**. Tanda's retrospective records approximately **100 participants**, while contemporary Tanda material describes the event as a roughly 24-hour hackathon.

The documented projects include:

- **Overall Winner — Love Your Work / team featuring Rod and Kaitlyn:** Tanda's retrospective identifies the winning team as one "co-starring Rod and Kaitlyn," while a contemporary participant account identifies the winning project as **Love Your Work**. The project used Tanda events to improve workplace connection: when a new employee joined, teammates received an introductory notification, while birthdays and work anniversaries also generated notifications.
- **Dave Allie Award for Engineering — Walk In Walk Out:** A touchless time-clock prototype using **facial recognition** to allow employees to clock in and out without manually interacting with a conventional terminal. This project is documented in the supplied 2017 event material.
- **Notable Build — NFC Student/Staff Card Time Clock:** A hardware/software prototype allowing workers to clock in by tapping an **NFC card**, such as a student ID, instead of entering a four-digit passcode. This project is documented in the supplied event recap.
- **Notable Build — Automated Unavailability Notifier:** A no-code workflow using **Tanda webhooks and Zapier** to automatically notify managers by email when an employee submitted new unavailable hours. The use of Zapier is consistent with Tanda's contemporary description of the event, which specifically highlighted no-code projects and Tanda's enthusiasm for Zapier at the time.
- **Mood Metrics:** A separate project reported by Tanda used **facial recognition on clock-in photos to estimate employee happiness**.
- **Flowpay:** Another project created an automated payment system that triggered an instantaneous payment based on timesheet information rather than waiting for the normal payroll process.
- **AWS/EC2 Webhook Prototype:** Participant Bernd Hartzer built a system that created and tagged an EC2 instance when an employee clocked in, using the user and shift IDs supplied by Tanda's webhook, and terminated the instance when the employee clocked out. His project demonstrates how the same webhook infrastructure could be used for infrastructure automation rather than directly for workforce features.

The 2017 event is therefore particularly interesting because it demonstrated that a relatively simple event-driven interface could support **facial recognition, workplace notifications, cloud infrastructure automation, payments, and no-code workflows**.

### 2016 — "We Have an API" Tanda Brisbane Hackathon

The **2016 hackathon** was organised around the launch of Tanda's first public API, humorously referred to internally as **"dAvePI."** Tanda's retrospective notes that the API effectively went from nothing to a working public interface in approximately two months, with the final version released only about a week before the hackathon and continuing to receive fixes during the event. The event attracted **147 ticket sales**.

- **Winning Project — Project 4 / Tanda–Fitbit Workplace Tracker:** The winning team built a working integration between **Fitbit activity data and Tanda's API**, using employee movement data to determine and visualise who moved around the most while working. Tanda specifically singled out Project 4 as one of the strongest examples of the event's fully functional products.

The project was significant because it demonstrated the value of treating Tanda as a **platform rather than merely an application**: external hardware and services could be connected to workforce information through the newly released API.

### 2015 — Inaugural "Open Data" Hackathon

Tanda's first hackathon was held in **March 2015** and centred on open workforce data. The event sold **59 tickets**, with a substantial proportion of attendees coming from QUT Code. Tanda's retrospective also notes that the supplied dataset itself had problems and had to be regenerated during the event.

- **Overall Winner — Sick-Day Predictor:** The winning team developed a machine-learning algorithm that predicted which employees were likely to take sick days. Tanda's retrospective states that the project's creators later founded **Maxwell MRI**, a medical-AI company.

This project established a pattern that would recur throughout Tanda's hackathons: taking relatively raw workforce information and turning it into a **novel predictive or decision-support application** within an extremely short development period.

### Evolution of Tanda's hackathon projects

| Year | Primary focus | Winner / major projects | Characteristic technology |
|---|---|---|---|
| **2015** | Open workforce data | Sick-Day Predictor | Machine learning / workforce analytics |
| **2016** | Public API | Tanda–Fitbit Workplace Tracker | API integration / wearable data |
| **2017** | Webhooks & automation | Love Your Work; Walk In Walk Out; NFC clock-in; Zapier workflows | Webhooks / facial recognition / NFC / no-code |
| **2018** | Employee Experience | I'll Get back2U; ETAssistant | Messenger bots / Android Auto / traffic data |
| **2025** | Generative AI & open experimentation | ProcrastiNOT; branching LLM; AI video LMS; AI family calendar | Claude / LLMs / AI agents / hardware / VR |
| **2026** | "Bring an idea to life" | Event currently underway | Claude Code / Anthropic API / open-ended experimentation |

The progression is striking. The **2015–2018 period was largely about making Tanda itself more extensible**: open datasets led to machine-learning experiments, the API enabled external integrations, and webhooks enabled event-driven automation. By 2025, the emphasis had shifted toward **rapidly creating entirely new products**, with AI acting as an accelerator rather than simply being a feature of Tanda's workforce platform. Tanda's 2025 organiser explicitly described the projects as being built across web, mobile, blockchain, hardware, and augmented reality in just 24 hours.

There is nevertheless a consistent philosophy underneath both eras: **build something people can actually try, make the prototype memorable, and see how much a small team can accomplish under severe time constraints**.

### 2026 — Current Brisbane AI Hackathon

Tanda's **2026 AI Hackathon — "Bring an idea to life"** is being held on **20–21 November 2026** at Tanda's Fortitude Valley office. The event provides participants with access to **Claude Code and the Anthropic API** and explicitly encourages projects ranging from games and small everyday annoyances to deliberately ridiculous experiments.

Because the event is taking place **right now**, its winning projects are not included in the historical winners list above. The Saturday evening demonstrations are the point at which the next cohort of projects will be presented.

### Source-quality note

The strongest sources for the historical record are Tanda's own **Product Team retrospectives and event recaps**. In particular, Tanda's 2018 recap directly documents the two 2018 winners, while its four-year retrospective directly documents the 2015 and 2016 winners and the 2017 winning team.

For 2025, the organiser **Austin Wilshire's public post** provides the clearest consolidated record of the rankings, while individual participants provide additional technical detail about projects such as ProcrastiNOT, the branching LLM interface, the AI-video LMS, and the Donald Trump RAG system.

A few projects—particularly the **2017 NFC clock-in and automated-unavailability projects and the 2025 mood-detecting VR project**—are supported by the supplied event material but have little or no independently discoverable technical documentation online. Those have therefore been retained but not given invented implementation details.

### References

1. **Tanda Product Team — "Looking back on 4 years of Hackathons" (2018).** Primary retrospective covering the 2015, 2016 and 2017 Brisbane events, including the sick-day predictor, Tanda–Fitbit integration, API history, participant numbers, and the 2017 winning team. [Tanda Product Team retrospective](https://medium.com/tanda-developers/looking-back-on-4-years-of-hackathons-86387d3b7dc4?utm_source=chatgpt.com)
2. **Dave Allie / Tanda Product Team — "Brisbane Tanda Hackathon 2018."** Primary event recap documenting the 2018 event, its 20 pitches, ETAssistant, and I'll Get back2U. [2018 Tanda Hackathon recap](https://medium.com/tanda-developers/brisbane-tanda-hackathon-2018-5e911c17d614?utm_source=chatgpt.com)
3. **Alex Ghiculescu / Tanda Product Team — "Hooking into a Hackathon with Tanda" (2017).** Contemporary account documenting the 2017 Webhooks theme, Love Your Work, Mood Metrics, and Flowpay. [2017 Tanda Webhooks recap](https://medium.com/tanda-developers/hooking-into-a-hackathon-with-tanda-fee2da0a30ef?utm_source=chatgpt.com)
4. **Alex Ghiculescu / Tanda Product Team — "EC2 fun with Tanda webhooks" (2017).** Participant account documenting an AWS/EC2 automation project built using Tanda's clock-in/out webhooks. [EC2 Tanda Webhooks project](https://medium.com/tanda-developers/ec2-fun-with-tanda-webhooks-5a77cddad54?utm_source=chatgpt.com)
5. **Austin Wilshire — 2025 Tanda Hackathon organiser recap.** Documents the 2025 rankings, participation, project categories, and judges.
6. **Riley Stuchbree — ProcrastiNOT participant account.** Provides additional technical detail on the 2025 first-place project.
7. **Sneharsh Belsare — 2025 second-place project account.** Provides additional detail on the branching/non-linear LLM interface.
8. **William Jackson — 2025 AI-video LMS participant account.** Provides additional detail about the second-place LMS project and its overnight API usage.
9. **Lliam Symonds / participant account — Donald Trump RAG project.** Provides technical details about the AI interviewer, embeddings, vector database and RAG system.
10. **2026 Tanda AI Hackathon event listing.** Documents the current 20–21 November 2026 event, its "Bring an idea to life" brief, Claude Code/Anthropic API access, and Fortitude Valley location.
