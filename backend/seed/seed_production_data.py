import asyncio
import os
from datetime import datetime, timezone

from passlib.context import CryptContext

from config.database import init_db, get_db
from config.settings import settings


async def seed_data() -> None:
    await init_db()
    db = get_db()
    if db is None:
        raise RuntimeError("Database connection is not available")

    pwd_ctx = CryptContext(schemes=["bcrypt"])
    now = datetime.now(timezone.utc).isoformat()

    admin_email = os.getenv("SEED_ADMIN_EMAIL", settings.DEFAULT_SUPERADMIN_EMAIL)
    admin_password = os.getenv("SEED_ADMIN_PASSWORD", settings.DEFAULT_SUPERADMIN_PASSWORD)

    await db.users.update_one(
        {"email": admin_email},
        {
            "$setOnInsert": {
                "email": admin_email,
                "name": "Super Admin",
                "password_hash": pwd_ctx.hash(admin_password),
                "role": "superadmin",
                "otp_required": False,
                "is_active": True,
                "created_at": now,
            },
            "$set": {
                "name": "Super Admin",
                "role": "superadmin",
                "otp_required": False,
                "is_active": True,
                "updated_at": now,
            },
        },
        upsert=True,
    )

    await db.users.update_one(
        {"email": "admin@example.com"},
        {
            "$setOnInsert": {
                "email": "admin@example.com",
                "name": "HR Admin",
                "password_hash": pwd_ctx.hash("Admin@1234"),
                "role": "admin",
                "otp_required": False,
                "is_active": True,
                "created_at": now,
            },
            "$set": {
                "name": "HR Admin",
                "role": "admin",
                "otp_required": False,
                "is_active": True,
                "updated_at": now,
            },
        },
        upsert=True,
    )

    await db.users.update_one(
        {"email": "reviewer@example.com"},
        {
            "$setOnInsert": {
                "email": "reviewer@example.com",
                "name": "Hiring Reviewer",
                "password_hash": pwd_ctx.hash("Reviewer@1234"),
                "role": "standard",
                "otp_required": False,
                "is_active": True,
                "created_at": now,
            },
            "$set": {
                "name": "Hiring Reviewer",
                "role": "standard",
                "otp_required": False,
                "is_active": True,
                "updated_at": now,
            },
        },
        upsert=True,
    )

    jobs = [
        {
            "doc_type": "job",
            "job_id": "job-prod-001",
            "title": "Senior Backend Engineer",
            "description": "Build scalable APIs and backend services using Python and FastAPI.",
            "difficulty": "hard",
            "employment_type": "full-time",
            "location": "Lahore, Pakistan",
            "salary_min": 180000,
            "salary_max": 260000,
            "is_remote": True,
            "company_name": "Acme Tech",
            "parsed_criteria": {"skills": ["Python", "FastAPI", "MongoDB"], "domain": "software_engineering"},
            "targeting": {"seniority": "senior", "location": "Pakistan"},
            "embedding": [],
            "candidate_pipeline": [
                {
                    "resume_id": "resume-prod-001",
                    "similarity_score": 0.92,
                    "pipeline_stage": "invited",
                    "added_at": now,
                }
            ],
            "created_by": admin_email,
            "created_at": now,
            "updated_at": now,
        },
        {
            "doc_type": "job",
            "job_id": "job-prod-002",
            "title": "Data Engineer",
            "description": "Design and maintain analytics pipelines and warehouse models.",
            "difficulty": "medium",
            "employment_type": "full-time",
            "location": "Karachi, Pakistan",
            "salary_min": 140000,
            "salary_max": 220000,
            "is_remote": False,
            "company_name": "DataForge",
            "parsed_criteria": {"skills": ["SQL", "Python", "Airflow"], "domain": "data_engineering"},
            "targeting": {"seniority": "mid", "location": "Pakistan"},
            "embedding": [],
            "candidate_pipeline": [
                {
                    "resume_id": "resume-prod-002",
                    "similarity_score": 0.89,
                    "pipeline_stage": "shortlisted",
                    "added_at": now,
                }
            ],
            "created_by": admin_email,
            "created_at": now,
            "updated_at": now,
        },
    ]

    for job in jobs:
        await db.jobs.update_one({"job_id": job["job_id"]}, {"$set": job}, upsert=True)

    resumes = [
        {
            "resume_id": "resume-prod-001",
            "filename": "ayesha_khan_resume.pdf",
            "candidate_name": "Ayesha Khan",
            "candidate_email": "ayesha.khan@example.com",
            "processing_status": "processed",
            "classification": {"job_domain": "software_engineering", "seniority_level": "senior", "skills": ["Python", "FastAPI", "MongoDB"]},
            "text": "Ayesha Khan is a senior backend engineer with Python and FastAPI experience.",
            "created_at": now,
            "updated_at": now,
        },
        {
            "resume_id": "resume-prod-002",
            "filename": "bilal_ahmed_resume.pdf",
            "candidate_name": "Bilal Ahmed",
            "candidate_email": "bilal.ahmed@example.com",
            "processing_status": "processed",
            "classification": {"job_domain": "data_engineering", "seniority_level": "mid", "skills": ["SQL", "Python", "Airflow"]},
            "text": "Bilal Ahmed is a data engineer with analytics pipeline experience.",
            "created_at": now,
            "updated_at": now,
        },
    ]

    for resume in resumes:
        await db.resumes.update_one({"resume_id": resume["resume_id"]}, {"$set": resume}, upsert=True)

    await db.upload_batches.update_one(
        {"batch_id": "batch-prod-001"},
        {"$set": {
            "batch_id": "batch-prod-001",
            "total_files": 2,
            "processed": 2,
            "skipped_duplicates": 0,
            "failed": 0,
            "auto_invited": 2,
            "status": "completed",
            "uploaded_by": admin_email,
            "created_at": now,
            "updated_at": now,
        }},
        upsert=True,
    )

    candidates = [
        {
            "doc_type": "candidate",
            "candidate_id": "candidate-prod-001",
            "job_id": "job-prod-001",
            "name": "Ayesha Khan",
            "email": "ayesha.khan@example.com",
            "resume_id": "resume-prod-001",
            "secure_token": "tok_seed_001",
            "token_status": "consumed",
            "status": "completed",
            "pipeline_stage": "completed",
            "invite_type": "manual",
            "session_active": False,
            "invited_by": admin_email,
            "invited_by_role": "admin",
            "transcript": [{"role": "candidate", "content": "I am excited to discuss backend architecture."}],
            "integrity_flags": [],
            "report": {
                "overall_score": 88,
                "technical_score": 90,
                "communication_score": 84,
                "problem_solving_score": 86,
                "cultural_fit_score": 90,
                "summary": "Strong backend engineering background and clear communication.",
                "recommendation": "strong_hire",
                "integrity_assessment": "No issues detected",
                "strengths": ["System design", "API design"],
                "areas_for_improvement": ["Leadership depth"],
            },
            "eval_score": 88,
            "invite_sent_at": now,
            "invite_resent_count": 0,
            "created_at": now,
        },
        {
            "doc_type": "candidate",
            "candidate_id": "candidate-prod-002",
            "job_id": "job-prod-002",
            "name": "Bilal Ahmed",
            "email": "bilal.ahmed@example.com",
            "resume_id": "resume-prod-002",
            "secure_token": "tok_seed_002",
            "token_status": "active",
            "status": "invited",
            "pipeline_stage": "invited",
            "invite_type": "auto",
            "session_active": False,
            "invited_by": "system",
            "invited_by_role": "system",
            "transcript": [],
            "integrity_flags": [],
            "report": None,
            "eval_score": None,
            "invite_sent_at": now,
            "invite_resent_count": 0,
            "created_at": now,
        },
    ]

    for candidate in candidates:
        await db.candidates.update_one({"candidate_id": candidate["candidate_id"]}, {"$set": candidate}, upsert=True)

    marketplace_docs = [
        {
            "profile_id": "profile-prod-001",
            "resume_id": "resume-prod-001",
            "name": "Ayesha Khan",
            "email": "ayesha.khan@example.com",
            "phone": "+92-300-1234567",
            "location": "Lahore, Pakistan",
            "summary": "Senior backend engineer with 8 years of experience building distributed systems.",
            "headline": "Senior Backend Engineer",
            "education": [{"degree": "BS Computer Science", "institution": "UET Lahore", "year": "2017"}],
            "experience": [
                {"title": "Senior Backend Engineer", "company": "Acme Tech", "duration": "2021-Present", "description": "Built scalable APIs and event-driven services."},
                {"title": "Software Engineer", "company": "Globex", "duration": "2018-2021", "description": "Developed Python services and integrations."},
            ],
            "projects": [{"name": "HR Analytics Platform", "description": "Led backend services for hiring analytics.", "technologies": ["Python", "FastAPI", "MongoDB"]}],
            "skills": ["Python", "FastAPI", "MongoDB", "Docker"],
            "certifications": ["AWS Certified Developer"],
            "languages": ["English", "Urdu"],
            "classification": {"job_domain": "software_engineering", "seniority_level": "senior", "skills": ["Python", "FastAPI", "MongoDB"]},
            "filename": "ayesha_khan_resume.pdf",
            "years_experience": 8,
            "availability_status": "available",
            "visibility": "internal",
            "consent_status": "opt_in",
            "source": {"filename": "ayesha_khan_resume.pdf", "resume_id": "resume-prod-001", "upload_batch": "batch-prod-001", "parser_version": "v1", "processing_model": "gpt-4o"},
            "is_hired": False,
            "hire_history": [],
            "data_quality": "complete",
            "profile_score": 92,
            "missing_fields": [],
            "last_resume_sync_at": now,
            "updated_at": now,
        },
        {
            "profile_id": "profile-prod-002",
            "resume_id": "resume-prod-002",
            "name": "Bilal Ahmed",
            "email": "bilal.ahmed@example.com",
            "location": "Karachi, Pakistan",
            "summary": "Data engineer with experience in analytics pipelines and BI systems.",
            "headline": "Data Engineer",
            "education": [{"degree": "MS Data Science", "institution": "FAST NUCES", "year": "2020"}],
            "experience": [{"title": "Data Engineer", "company": "DataForge", "duration": "2020-Present", "description": "Built ETL pipelines and warehouse models."}],
            "projects": [],
            "skills": ["SQL", "Python", "Airflow", "dbt"],
            "certifications": [],
            "languages": ["English", "Urdu"],
            "classification": {"job_domain": "data_engineering", "seniority_level": "mid", "skills": ["SQL", "Python", "Airflow"]},
            "filename": "bilal_ahmed_resume.pdf",
            "years_experience": 4,
            "availability_status": "available",
            "visibility": "internal",
            "consent_status": "opt_in",
            "source": {"filename": "bilal_ahmed_resume.pdf", "resume_id": "resume-prod-002", "upload_batch": "batch-prod-001", "parser_version": "v1", "processing_model": "gpt-4o"},
            "is_hired": True,
            "hired_company": "DataForge",
            "hired_job_title": "Data Engineer",
            "hire_history": [{"company": "DataForge", "job_title": "Data Engineer", "updated_at": now}],
            "data_quality": "partial",
            "profile_score": 74,
            "missing_fields": ["linkedin_url"],
            "last_resume_sync_at": now,
            "updated_at": now,
        },
    ]

    for profile in marketplace_docs:
        await db[settings.MARKETPLACE_COLLECTION].update_one({"profile_id": profile["profile_id"]}, {"$set": profile}, upsert=True)

    print("Seed completed successfully")


if __name__ == "__main__":
    asyncio.run(seed_data())
