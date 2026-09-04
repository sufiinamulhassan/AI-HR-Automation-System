"""
Adaptive Interview Engine powered by OpenAI.
Generates dynamic questions from JD + resume and processes responses adaptively.
"""

from typing import Dict, List
import time
import json


class AdaptiveInterviewEngine:
    """
    Core conversational execution engine for adaptive interviews.
    Uses OpenAI API to parse the Job Description and candidate resume,
    then generates tailored, multi-category interview questions dynamically.
    """

    def __init__(self):
        self.sessions_state: Dict[str, dict] = {}
        self.default_questions = [
            "Could you introduce yourself and tell us about your background?",
            "Can you describe your approach to problem-solving?",
            "What technologies or architectural patterns are you most passionate about and why?",
            "Can you discuss a challenging project you've worked on recently?",
            "How do you handle disagreements within a development team?",
            "Walk me through how you would debug a production issue that affects 10% of users.",
            "What is the difference between SQL and NoSQL databases? When would you choose one over the other?",
            "Describe a time when you had to learn a new technology quickly for a project.",
            "If you were given a legacy codebase with no documentation, how would you approach understanding it?",
            "Thank you. That concludes the core evaluation. Do you have any questions for us?",
        ]

    def _generate_questions_with_openai(self, job: dict, resume: dict) -> List[str]:
        """Use OpenAI to generate 10+ dynamic interview questions from JD and resume."""
        from services.llm_client import ask_openai

        job_title = job.get("title", "Software Engineer")
        job_desc = job.get("description", "")
        difficulty = job.get("difficulty", "Mid")
        resume_text = resume.get("text", "")

        prompt = f"""You are an expert technical interviewer. Based on the following Job Description and Candidate Resume, generate between 15 to 20 interview questions.

**CRITICAL RULE:** ALL questions must be STRICTLY derived from the provided Job Description and the Candidate's Resume. Do NOT ask outside, generic, or off-topic questions.

**JOB TITLE:** {job_title}
**DIFFICULTY LEVEL:** {difficulty}

**JOB DESCRIPTION:**
{job_desc}

**CANDIDATE RESUME:**
{resume_text[:3000]}

**REQUIREMENTS:**
Generate between 15 to 20 questions with the following strict distribution:
1. **Introduction** (1 question): Ask the candidate to introduce themselves in context of this role and their background.
2. **Resume Projects** (3 to 5 questions): Ask specific questions about the projects the candidate mentioned in their resume. Dive into their specific contributions and tools used.
3. **Technical / Role-Specific** (3 to 5 questions): If this is a technical job, ask technical questions directly related to the tech-stack mentioned in the Job Description.
4. **Problem Solving & Alignment** (Remaining questions): Ask problem-solving questions and scenarios that directly relate their past experience (from the Resume) to the responsibilities they will face in the role (from the Job Description).
5. **Closing** (1 question): A concluding question that wraps up the interview and asks if they have questions for us.

**FORMAT:**
Return ONLY a JSON array of strings, each string being one question. No numbering, no categories, no explanation, just the JSON array.

Example format:
["Question 1 text here?", "Question 2 text here?", ...]
"""

        system = "You are an expert HR interviewer and technical assessor. Generate precise, role-specific interview questions. Return only valid JSON."

        response = ask_openai(prompt, system=system, max_tokens=3000, temperature=0.6)

        if response:
            try:
                import re
                cleaned = response.strip()
                if cleaned.startswith("```"):
                    cleaned = re.sub(r'^```[a-zA-Z]*\n?', '', cleaned)
                    cleaned = re.sub(r'\n?```$', '', cleaned).strip()

                questions = json.loads(cleaned)
                if isinstance(questions, list) and len(questions) >= 5:
                    print(f"[OK] LLM generated {len(questions)} interview questions")
                    return questions
            except (json.JSONDecodeError, ValueError):
                pass

            try:
                import re
                m = re.search(r'\[.*\]', response, re.DOTALL)
                if m:
                    questions = json.loads(m.group(0))
                    if isinstance(questions, list) and len(questions) >= 5:
                        print(f"[OK] LLM generated {len(questions)} interview questions (extracted from prose)")
                        return questions
            except (json.JSONDecodeError, ValueError) as e:
                print(f"[WARN] Failed to parse LLM questions response: {e}")

        print("[WARN] Using default questions (OpenAI generation failed)")
        return self.default_questions

    def _generate_custom_questions(self, job: dict, resume: dict) -> List[str]:
        """Generate custom interview questions — uses OpenAI if available, else heuristic."""
        questions = self._generate_questions_with_openai(job, resume)
        if questions and len(questions) >= 5:
            return questions

        questions = ["Could you introduce yourself and summarize your background as highlighted in your resume?"]

        job_desc = job.get("description", "").lower()
        if "python" in job_desc or "django" in job_desc or "fastapi" in job_desc:
            questions.append("The job requires strong Python skills. Can you describe how you've optimized a Python application in the past?")
        elif "react" in job_desc or "frontend" in job_desc:
            questions.append("This role is frontend-heavy. Could you walk us through your process of handling complex state in React?")
        else:
            questions.append(f"Based on the job requirements for {job.get('title', 'this role')}, how does your previous experience align with our goals?")

        resume_text = resume.get("text", "").lower()
        if "aws" in resume_text or "cloud" in resume_text or "azure" in resume_text:
            questions.append("I see cloud experience on your resume. Could you share a challenging deployment or cloud architecture you've managed?")
        elif "lead" in resume_text or "manager" in resume_text:
            questions.append("Your resume mentions leadership experience. How do you handle conflicts within an engineering team?")
        else:
            questions.append("I noticed several interesting projects on your resume. Which one are you most proud of, and why?")

        questions.extend([
            "How do you approach learning a new programming language or framework?",
            "Describe a bug that took you a long time to find. What made it difficult?",
            "How do you ensure code quality in your projects?",
            "Explain a data structure you've used recently and why it was the right choice.",
            "If you were designing a system to handle 1 million requests per second, what would your approach be?",
            "Tell me about a time you received critical feedback. How did you respond?",
            "That concludes the technical and behavioral evaluation. Do you have any final questions for us?",
        ])
        return questions

    def init_session(self, session_id: str):
        """Initialize a new interview session."""
        if session_id in self.sessions_state:
            return

        start_time = time.time()

        from database import get_db
        db = get_db()
        questions = self.default_questions

        job_title = ""
        job_desc = ""

        if db is not None:
            candidate = db.candidates.find_one({"doc_type": "candidate", "secure_token": session_id})
            if candidate:
                job_id = candidate.get("job_id")
                resume_id = candidate.get("resume_id")
                job = db.jobs.find_one({"doc_type": "job", "job_id": job_id}) if job_id else None
                resume = db.resumes.find_one({"doc_type": "resume", "resume_id": resume_id}) if resume_id else None

                if job and resume:
                    questions = self._generate_custom_questions(job, resume)
                    job_title = job.get("title", "")
                    job_desc = job.get("description", "")

        self.sessions_state[session_id] = {
            "current_index": 0,
            "transcript": [],
            "start_time": start_time,
            "expires_at": start_time + 30 * 60,
            "integrity_flags": [],
            "questions": questions,
            "job_title": job_title,
            "job_desc": job_desc,
            "finalized": False,
        }

    def is_session_expired(self, session_id: str) -> bool:
        """Return True when the 30 minute interview window has elapsed."""
        state = self.sessions_state.get(session_id)
        if not state:
            return False

        expires_at = state.get("expires_at")
        if expires_at is None:
            return False

        return time.time() >= expires_at

    def is_session_finished(self, session_id: str) -> bool:
        """Return True when the session has exhausted the question list or been finalized."""
        state = self.sessions_state.get(session_id)
        if not state:
            return False

        if state.get("finalized"):
            return True

        questions = state.get("questions", self.default_questions)
        return state.get("current_index", 0) >= len(questions)

    def get_next_question(self, session_id: str) -> str:
        """Get the next interview question for the given session."""
        state = self.sessions_state.get(session_id)
        if not state:
            return "Session not found. Please reconnect."

        if state.get("finalized") or self.is_session_expired(session_id):
            return "The 30 minute interview window has ended. The interview is now completed. You may close this window."

        idx = state["current_index"]
        questions = state.get("questions", self.default_questions)
        if idx < len(questions):
            question = questions[idx]
            
            if not state["transcript"] or state["transcript"][-1]["content"] != question:
                state["transcript"].append({"role": "agent", "content": question})
                
            return question
        return "Thank you for your responses. The interview is now completed. You may close this window."

    def _generate_final_response(self, session_id: str, candidate_text: str) -> str:
        """Answer the candidate's last questions and provide a final closing statement."""
        from services.llm_client import ask_openai
        state = self.sessions_state.get(session_id)
        if not state:
            return "Thank you for your responses. The interview is now completed."

        job_title = state.get("job_title", "")
        job_desc = state.get("job_desc", "")
        
        prompt = f"""You are a professional HR Interviewer. The interview is wrapping up.
You just asked the candidate: "Do you have any questions for us?"
The candidate replied: "{candidate_text}"

**JOB CONTEXT:** {job_title}\n{job_desc[:1000]}

**INSTRUCTIONS:**
1. If the candidate asked a specific question about the role or company, provide a BRIEF, professional answer based on the job context.
2. If they did NOT ask a question (e.g. they said "No, I'm good"), skip the answer part.
3. IN ALL CASES, conclude with a warm, professional sign-off thanking them for their time and stating that the HR team will reach out with next steps.

Return ONLY the response text.
"""
        response = ask_openai(prompt, system="You are a helpful HR Interviewer bot.", max_tokens=400, temperature=0.5)
        
        if not response:
            return "Thank you for your time today. It was a pleasure speaking with you. The interview is now completed. You may close this window."
        
        return response

    def process_response(self, session_id: str, candidate_text: str) -> str:
        """Process a candidate's response and return the next question."""
        state = self.sessions_state.get(session_id)
        if not state:
            return "Session not found. Please reconnect."

        questions = state.get("questions", self.default_questions)
        
        state["transcript"].append({"role": "candidate", "content": candidate_text})

        if state["current_index"] == len(questions) - 1:
            final_reply = self._generate_final_response(session_id, candidate_text)
            
            state["transcript"].append({"role": "agent", "content": final_reply})
            
            state["current_index"] += 1
            
            return final_reply

        state["current_index"] += 1
        return self.get_next_question(session_id)

    def log_integrity_flag(self, session_id: str, flag_type: str):
        """Log an integrity violation for the given session."""
        state = self.sessions_state.get(session_id)
        if state:
            state["integrity_flags"].append(
                {"type": flag_type, "timestamp": time.time()}
            )

    def get_transcript(self, session_id: str) -> List[dict]:
        """Return the full interview transcript for a session."""
        state = self.sessions_state.get(session_id)
        if not state:
            return []
        return state["transcript"]

    def generate_report(self, session_id: str, job: dict = None) -> str:
        """Use OpenAI to generate a comprehensive interview evaluation report."""
        from services.llm_client import ask_openai

        state = self.sessions_state.get(session_id)
        transcript = state["transcript"] if state else []

        if not transcript:
            from database import get_db
            db = get_db()
            if db is not None:
                candidate = db.candidates.find_one({"doc_type": "candidate", "secure_token": session_id})
                if candidate:
                    transcript = candidate.get("transcript", [])

        if not transcript:
            return "No interview data available for report generation."

        transcript_text = "\n".join([
            f"{'INTERVIEWER' if msg['role'] == 'agent' else 'CANDIDATE'}: {msg['content']}"
            for msg in transcript
        ])

        job_context = ""
        if job:
            job_context = f"\n**Job Title:** {job.get('title', 'N/A')}\n**Job Description:** {job.get('description', 'N/A')[:1500]}\n"

        integrity_flags = []
        if state:
            integrity_flags = [f.get("type", str(f)) if isinstance(f, dict) else str(f) for f in state.get("integrity_flags", [])]
        if not integrity_flags:
            from database import get_db
            db = get_db()
            if db is not None:
                candidate = db.candidates.find_one({"doc_type": "candidate", "secure_token": session_id})
                if candidate:
                    integrity_flags = candidate.get("integrity_flags", [])

        integrity_context = ""
        if integrity_flags:
            flags_text = "\n".join([f"- {flag}" for flag in integrity_flags])
            integrity_context = f"""
**INTEGRITY VIOLATIONS DETECTED ({len(integrity_flags)} total):**
{flags_text}
"""

        prompt = f"""Based on the following interview transcript, generate a comprehensive evaluation report.
{job_context}
**INTERVIEW TRANSCRIPT:**
{transcript_text}
{integrity_context}
**Generate a structured report with the following sections:**

## Candidate Overview
Brief summary of the candidate based on their responses.

## Technical Competency (Score: X/10)
Assess their technical knowledge, coding ability, and system design understanding.

## Communication Skills (Score: X/10)
Evaluate clarity, articulation, and ability to explain complex concepts.

## Problem-Solving Ability (Score: X/10)
Assess their approach to problem-solving, debugging, and critical thinking.

## Cultural Fit & Soft Skills (Score: X/10)
Evaluate teamwork, leadership potential, and behavioral responses.

## Strengths
List 3-5 key strengths observed.

## Areas for Improvement
List 2-3 areas where the candidate could improve.

## Integrity Concerns
Report any tab switching, suspicious behavior, or camera/microphone issues that were detected during the interview. If no violations, state "No integrity concerns detected."

## Overall Recommendation
Provide a clear recommendation: STRONG HIRE / HIRE / MAYBE / NO HIRE
Include a brief justification. Factor in any integrity concerns.

## Overall Score: X/10
"""

        system = "You are a senior HR evaluation expert. Generate detailed, fair, and objective interview assessment reports. Be specific and reference actual responses from the transcript."

        report = ask_openai(prompt, system=system, max_tokens=3000, temperature=0.4)

        if not report:
            return "Report generation failed. OpenAI API may be unavailable."

        return report
