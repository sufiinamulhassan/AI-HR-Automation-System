"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_V1_BASE, getInterviewReportPdfUrl, getInterviewReportUrl } from '@/lib/runtimeConfig';

const API_BASE = API_V1_BASE;

export default function Dashboard() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [resumes, setResumes] = useState<any[]>([]);
  const [selectedCandidateResult, setSelectedCandidateResult] = useState<any>(null);
  const [resumePreviewModal, setResumePreviewModal] = useState<{
    resume: any;
    loading: boolean;
    mode: 'pdf' | 'text' | 'unavailable';
    text: string;
    fileUrl: string;
  } | null>(null);
  const [reportModal, setReportModal] = useState<{ resume: any; report: string; loading: boolean } | null>(null);
  const [remarksModal, setRemarksModal] = useState<{ resumeId: string; filename: string } | null>(null);
  const [remarksDraft, setRemarksDraft] = useState('');
  const [isSavingRemarks, setIsSavingRemarks] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [admins, setAdmins] = useState<any[]>([]);
  const [isAdminBusy, setIsAdminBusy] = useState(false);
  const [editingAdminEmail, setEditingAdminEmail] = useState<string | null>(null);
  const [adminForm, setAdminForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'admin',
    is_active: true,
  });
  const [decisionModal, setDecisionModal] = useState<{ resumeId: string; status: 'hired' | 'rejected'; candidateName: string } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const [showJobForm, setShowJobForm] = useState(false);
  const [jobSearchTerm, setJobSearchTerm] = useState('');
  const [resumeSearchTerm, setResumeSearchTerm] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [jobDesc, setJobDesc] = useState('');
  const [jobDiff, setJobDiff] = useState('Mid');
  const [jobType, setJobType] = useState('Full Time');
  const [jobLocation, setJobLocation] = useState('Remote');
  const [jobSalaryMin, setJobSalaryMin] = useState('100000');
  const [jobSalaryMax, setJobSalaryMax] = useState('200000');
  const [jobRemote, setJobRemote] = useState(true);
  const [jobCurrency, setJobCurrency] = useState('$');
  const [dashboardStats, setDashboardStats] = useState({
    total_openings: 0,
    total_applications: 0,
    shortlisted: 0,
    interviewed: 0,
    rejected: 0,
    hired: 0,
    recent_interviews: [] as any[],
    all_resumes: [] as any[]
  });
  const [metricModal, setMetricModal] = useState<string | null>(null);
  const [metricModalSearch, setMetricModalSearch] = useState('');

  const [isEditingJob, setIsEditingJob] = useState(false);

  const [files, setFiles] = useState<FileList | null>(null);
  const [interviewSearchTerm, setInterviewSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInvitingId, setIsInvitingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [selectedVacancy, setSelectedVacancy] = useState<any | null>(null);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const vacancyCarouselRef = useRef<HTMLDivElement>(null);
  const [showTopButton, setShowTopButton] = useState(false);

  const [activeView, setActiveView] = useState<'jobs' | 'resumes' | 'candidates' | 'usermgmt' | 'settings'>('jobs');
  const [activeTab, setActiveTab] = useState<'pipeline' | 'details' | 'upload'>('pipeline');
  const [pipelineFilter, setPipelineFilter] = useState('all');
  const [dragActive, setDragActive] = useState(false);
  const [resumeLibSearch, setResumeLibSearch] = useState('');
  const [resumeLibDomain, setResumeLibDomain] = useState('');
  const [resumeLibLevel, setResumeLibLevel] = useState('');
  const [candidatesSearch, setCandidatesSearch] = useState('');
  const [candidatesStatusFilter, setCandidatesStatusFilter] = useState('');
  const [candidatesJobFilter, setCandidatesJobFilter] = useState('');
  const [selectedModel, setSelectedModel] = useState('gpt-4o');
  const [isModelSaving, setIsModelSaving] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [appSettings, setAppSettings] = useState({
    company_name: 'Hirely.ai',
    portal_title: 'Admin Portal',
    interview_duration_minutes: 30,
    max_questions: 10,
    hire_score_threshold: 8.0,
    await_score_threshold: 6.0,
    reject_score_threshold: 5.0,
    screening_shortlist_threshold: 0.80,
    screening_reject_threshold: 0.70,
    otp_required_default: false,
  });
  const [showResetPwModal, setShowResetPwModal] = useState<string | null>(null);
  const [resetPwValue, setResetPwValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const toIntegrityText = (flag: any) => {
    if (flag == null) return '';
    if (typeof flag === 'string') return flag;
    if (typeof flag === 'object') {
      const kind = flag.type ? String(flag.type) : 'Integrity alert';
      const stamp = typeof flag.timestamp === 'number'
        ? new Date(flag.timestamp * 1000).toLocaleTimeString()
        : '';
      return stamp ? `${kind} (${stamp})` : kind;
    }
    return String(flag);
  };

  const normalizeIntegrityFlags = (flags: any) =>
    Array.isArray(flags)
      ? flags.map((f: any) => toIntegrityText(f)).filter(Boolean)
      : [];

  const getAuthToken = () => (typeof window !== 'undefined' ? localStorage.getItem('token') : null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('theme');
    }

    const token = getAuthToken();
    if (!token) {
      router.push('/login');
      return;
    }

    fetchCurrentUser(token);
    fetchJobs();
    fetchStats();

    fetch(`${API_BASE}/settings/model`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.model) setSelectedModel(data.model); })
      .catch(() => {});

    fetch(`${API_BASE}/settings/app`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setAppSettings(s => ({ ...s, ...data })); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showJobForm || selectedVacancy || selectedCandidateResult || resumePreviewModal || reportModal || metricModal || remarksModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [showJobForm, selectedVacancy, selectedCandidateResult, resumePreviewModal, reportModal, metricModal, remarksModal, showAdminModal, decisionModal]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      setShowTopButton(window.scrollY > 300);
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (jobs.length === 0) return;
    const interval = setInterval(() => {
      if (vacancyCarouselRef.current) {
        const carousel = vacancyCarouselRef.current;
        const isAtEnd = carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 10;
        
        if (isAtEnd) {
          carousel.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
          const nextIndex = activeCardIndex + 1;
          const card = carousel.children[0]?.children[nextIndex] as HTMLElement;
          if (card) {
            carousel.scrollTo({ left: card.offsetLeft - 40, behavior: 'smooth' });
          }
        }
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [activeCardIndex, jobs.length]);

  useEffect(() => {
    const refreshInterval = setInterval(() => {
      fetchJobs();
      fetchStats();
      if (selectedJob?.job_id) {
        fetchResumes(selectedJob.job_id);
      }
    }, 15000);

    return () => clearInterval(refreshInterval);
  }, [selectedJob]);

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs/`);
      const data = await res.json();
      if (Array.isArray(data)) setJobs([...data].reverse());
      fetchStats();
    } catch (e) {
      console.error("Fetch Jobs Error:", e);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs/dashboard/stats`);
      const data = await res.json();
      setDashboardStats(data || {
        total_openings: 0,
        total_applications: 0,
        shortlisted: 0,
        interviewed: 0,
        rejected: 0,
        hired: 0
      });
    } catch (e) {
      console.error("Fetch Stats Error:", e);
    }
  };

  const fetchCurrentUser = async (tokenOverride?: string) => {
    try {
      const token = tokenOverride || getAuthToken();
      if (!token) {
        router.push('/login');
        return;
      }
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        localStorage.removeItem('token');
        router.push('/login');
        return;
      }
      const me = await res.json();
      setCurrentUser(me);
      if (me?.role === 'superadmin') {
        fetchAdmins(token);
      }
    } catch (e) {
      console.error(e);
      localStorage.removeItem('token');
      router.push('/login');
    }
  };

  const fetchAdmins = async (tokenOverride?: string) => {
    try {
      const token = tokenOverride || getAuthToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/auth/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const onlyAdmins = Array.isArray(data)
        ? data.filter((u: any) => u.role === 'admin' || u.role === 'superadmin')
        : [];
      setAdmins(onlyAdmins);
    } catch (e) {
      console.error(e);
    }
  };

  const resetAdminForm = () => {
    setEditingAdminEmail(null);
    setAdminForm({ name: '', email: '', password: '', role: 'admin', is_active: true });
  };

  const openAdminCreate = () => {
    resetAdminForm();
    setShowAdminModal(true);
  };

  const openAdminEdit = (admin: any) => {
    setEditingAdminEmail(admin.email);
    setAdminForm({
      name: admin.name || '',
      email: admin.email || '',
      password: '',
      role: admin.role || 'admin',
      is_active: admin.is_active !== false,
    });
  };

  const saveAdmin = async () => {
    const token = getAuthToken();
    if (!token) return;

    if (!adminForm.name.trim() || !adminForm.email.trim()) {
      showToast('Name and email are required', 'error');
      return;
    }

    if (!editingAdminEmail && adminForm.password.trim().length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    setIsAdminBusy(true);
    try {
      if (editingAdminEmail) {
        const payload: any = {
          name: adminForm.name.trim(),
          email: adminForm.email.trim(),
          role: adminForm.role,
          is_active: adminForm.is_active,
        };
        if (adminForm.password.trim()) payload.password = adminForm.password.trim();

        const res = await fetch(`${API_BASE}/auth/users/${encodeURIComponent(editingAdminEmail)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || 'Failed to update admin');
        }
        showToast('Admin updated successfully');
      } else {
        const res = await fetch(`${API_BASE}/auth/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: adminForm.name.trim(),
            email: adminForm.email.trim(),
            password: adminForm.password.trim(),
            role: adminForm.role,
            otp_required: false,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || 'Failed to create admin');
        }
        showToast('Admin created successfully');
      }
      resetAdminForm();
      await fetchAdmins(token);
    } catch (e: any) {
      showToast(e.message || 'Failed to save admin', 'error');
    }
    setIsAdminBusy(false);
  };

  const deleteAdmin = async (email: string) => {
    if (!confirm(`Delete admin ${email}?`)) return;
    const token = getAuthToken();
    if (!token) return;

    setIsAdminBusy(true);
    try {
      const res = await fetch(`${API_BASE}/auth/users/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to delete admin');
      }
      showToast('Admin deleted');
      await fetchAdmins(token);
    } catch (e: any) {
      showToast(e.message || 'Failed to delete admin', 'error');
    }
    setIsAdminBusy(false);
  };

  const resetAdminPw = async () => {
    if (!showResetPwModal || resetPwValue.trim().length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }
    const token = getAuthToken();
    if (!token) return;
    setIsAdminBusy(true);
    try {
      const res = await fetch(`${API_BASE}/auth/users/${encodeURIComponent(showResetPwModal)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: resetPwValue.trim() }),
      });
      if (!res.ok) throw new Error('Failed to reset password');
      showToast('Password reset successfully');
      setShowResetPwModal(null);
      setResetPwValue('');
    } catch (e: any) {
      showToast(e.message || 'Failed to reset password', 'error');
    }
    setIsAdminBusy(false);
  };

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/jobs/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: jobTitle,
          description: jobDesc,
          difficulty: jobDiff,
          employment_type: jobType,
          location: jobLocation,
          salary_min: jobSalaryMin ? Number(jobSalaryMin) : null,
          salary_max: jobSalaryMax ? Number(jobSalaryMax) : null,
          is_remote: jobRemote,
          currency: jobCurrency,
        }),
      });
      if (res.ok) {
        setJobTitle('');
        setJobDesc('');
        setJobDiff('Mid');
        setJobType('Full Time');
        setJobLocation('Remote');
        setJobSalaryMin('100000');
        setJobSalaryMax('200000');
        setJobRemote(true);
        setJobCurrency('$');
        setShowJobForm(false);
        showToast('Job position published successfully!');
        await fetchJobs();
      }
    } catch (e) {
      console.error(e);
      showToast('Failed to create job', 'error');
    }
    setIsLoading(false);
  };

  const handleEditJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVacancy) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/jobs/${selectedVacancy.job_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: jobTitle,
          description: jobDesc,
          difficulty: jobDiff,
          employment_type: jobType,
          location: jobLocation,
          salary_min: jobSalaryMin ? Number(jobSalaryMin) : null,
          salary_max: jobSalaryMax ? Number(jobSalaryMax) : null,
          is_remote: jobRemote,
          currency: jobCurrency,
        }),
      });
      if (res.ok) {
        const updatedJob = await res.json();
        setSelectedVacancy(updatedJob);
        if (selectedJob?.job_id === updatedJob.job_id) {
          setSelectedJob(updatedJob);
        }
        setIsEditingJob(false);
        showToast('Job position updated successfully!');
        await fetchJobs();
      } else {
        throw new Error('Failed to update');
      }
    } catch (e) {
      console.error(e);
      showToast('Failed to edit job', 'error');
    }
    setIsLoading(false);
  };

  const openJobEdit = (e: React.MouseEvent, job: any) => {
    e.stopPropagation();
    setJobTitle(job.title || '');
    setJobDesc(job.description || '');
    setJobDiff(job.difficulty || 'Mid');
    setJobType(job.employment_type || 'Full Time');
    setJobLocation(job.location || 'Remote');
    setJobSalaryMin(job.salary_min ? job.salary_min.toString() : '');
    setJobSalaryMax(job.salary_max ? job.salary_max.toString() : '');
    setJobRemote(job.is_remote ?? true);
    setJobCurrency(job.currency || '$');
    setSelectedVacancy(job);
    setIsEditingJob(true);
  };

  const selectJob = async (job: any) => {
    setSelectedJob(job);
    setActiveTab('pipeline');
    fetchResumes(job.job_id);
  };

  const fetchResumes = async (jobId: string) => {
    try {
      const res = await fetch(`${API_BASE}/resumes/${jobId}`);
      let resumesData = await res.json();
      
      try {
        const cRes = await fetch(`${API_BASE}/candidates/${jobId}`);
        const candidatesData = await cRes.json();
        
        if (Array.isArray(candidatesData) && Array.isArray(resumesData)) {
          resumesData = resumesData.map((r: any) => {
            const relevantCandidates = candidatesData.filter((c: any) => c.resume_id === r.resume_id);
            if (relevantCandidates.length > 0) {
              const cand = relevantCandidates.find((c: any) => c.status === 'completed' || c.transcript) || relevantCandidates[relevantCandidates.length - 1];
              
              if (cand.integrity_flags?.length > 0) {
                r.integrity_flags = normalizeIntegrityFlags(cand.integrity_flags);
              }
              if (cand.transcript) {
                r.transcript = cand.transcript;
              }
              if (cand.secure_token) {
                r.secure_token = cand.secure_token;
              }
              if (cand.report) {
                r.report = cand.report;
              }
              if (cand.eval_score !== undefined) {
                r.eval_score = cand.eval_score;
              }
              if (cand.status) {
                r.candidate_status = cand.status;
              }
            }
            return r;
          });
        }
      } catch (ce) {
        console.error("Candidates fetch error", ce);
      }
      
      if (Array.isArray(resumesData)) setResumes(resumesData);
      else setResumes([]);
    } catch (e) {
      console.error(e);
      setResumes([]);
    }
  };

  const handleUploadResumes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files || files.length === 0 || !selectedJob) return;
    setIsLoading(true);
    
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }

    try {
      const res = await fetch(`${API_BASE}/resumes/upload/${selectedJob.job_id}`, {
          method: 'POST',
          body: formData
      });
      if (res.ok) {
        const data = await res.json();
        showToast(data.message || 'Resumes uploaded! Automatically starting AI screening...');
        
        await handleScreenResumes();
      }
      setFiles(null);
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      await fetchResumes(selectedJob.job_id);
      await fetchJobs();
    } catch (e) {
      console.error(e);
      showToast('Upload failed', 'error');
    }
    setIsLoading(false);
  };

  const handleScreenResumes = async () => {
    if (!selectedJob) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/resumes/screen/${selectedJob.job_id}`, {
          method: 'POST'
      });
      if (res.ok) {
        showToast('AI screening completed!');
      }
      await fetchResumes(selectedJob.job_id);
      await fetchJobs();
    } catch(e) {
      console.error(e);
      showToast('Screening failed', 'error');
    }
    setIsLoading(false);
  };

  const generateInterviewLink = async (resume: any) => {
    if (!selectedJob) return;
    setIsInvitingId(resume.resume_id);
    try {
      const candidateName = (resume.candidate_name || resume.filename || 'Candidate').toString().trim();
      const invitedBy = currentUser?.name || 'HR';
      const invitedByRole = currentUser?.role || 'admin';
      const res = await fetch(`${API_BASE}/candidates/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: selectedJob.job_id,
            name: candidateName,
            email: 'candidate@example.com',
            resume_id: resume.resume_id,
            invited_by: invitedBy,
            invited_by_role: invitedByRole,
          })
      });
      const data = await res.json();
      const link = `${window.location.origin}/interview/${data.secure_token}`;
      await navigator.clipboard.writeText(link).catch(() => {});
      
      setCopiedId(resume.resume_id);
      setTimeout(() => setCopiedId(null), 3000);
      
      await fetchResumes(selectedJob.job_id);
      await fetchJobs();
    } catch (e) {
      console.error(e);
      showToast('Failed to create invite', 'error');
    }
    setIsInvitingId(null);
  };

  const handleGenerateReport = async (resume: any) => {
    setOpenDropdown(null);
    if (!resume.secure_token) {
      showToast('No interview token found for this candidate', 'error');
      return;
    }
    setReportModal({ resume, report: '', loading: true });
    try {
      let reportText = '';
      try {
        const getRes = await fetch(getInterviewReportUrl(resume.secure_token));
        if (getRes.ok) {
          const data = await getRes.json();
          reportText = data.report;
        }
      } catch {}

      if (!reportText) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);
        
        const reportUrl = `${API_BASE}/interview/report/${resume.secure_token}`;
        console.log('[DEBUG] Requesting Report URL:', reportUrl);

        const res = await fetch(reportUrl, {
          method: 'POST',
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          reportText = data.report;
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || 'Report generation failed');
        }
      }

      setReportModal({ resume, report: reportText, loading: false });
    } catch (e: any) {
      console.error(e);
      setReportModal(null);
      showToast(e.message || 'Failed to generate report', 'error');
    }
  };

  const handleViewResults = (resume: any) => {
    setOpenDropdown(null);
    setSelectedCandidateResult({
      ...resume,
      integrity_flags: normalizeIntegrityFlags(resume.integrity_flags),
    });
  };

  const handleViewResume = async (resume: any) => {
    setResumePreviewModal({
      resume,
      loading: true,
      mode: 'unavailable',
      text: '',
      fileUrl: '',
    });

    try {
      const res = await fetch(`${API_BASE}/resumes/${resume.resume_id}/content`);
      if (!res.ok) throw new Error('Failed to load resume content');
      const data = await res.json();

      const mime = (data.mime_type || '').toLowerCase();
      if (data.has_file && mime.includes('pdf')) {
        setResumePreviewModal({
          resume,
          loading: false,
          mode: 'pdf',
          text: '',
          fileUrl: `${API_BASE}/resumes/${resume.resume_id}/file`,
        });
        return;
      }

      if (data.text && data.text.trim()) {
        setResumePreviewModal({
          resume,
          loading: false,
          mode: 'text',
          text: data.text,
          fileUrl: '',
        });
        return;
      }

      setResumePreviewModal({
        resume,
        loading: false,
        mode: 'unavailable',
        text: '',
        fileUrl: '',
      });
    } catch {
      setResumePreviewModal({
        resume,
        loading: false,
        mode: 'unavailable',
        text: '',
        fileUrl: '',
      });
    }
  };

  const scrollVacancies = (direction: 'left' | 'right') => {
    const container = vacancyCarouselRef.current;
    if (!container) return;
    const delta = Math.max(container.clientWidth * 0.82, 280);
    container.scrollBy({ left: direction === 'right' ? delta : -delta, behavior: 'smooth' });
  };

  const handleDeleteJob = async (jobId: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/jobs/${jobId}`, { method: 'DELETE' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to delete job');
      }

      if (selectedJob?.job_id === jobId) {
        setSelectedJob(null);
        setResumes([]);
      }
      if (selectedVacancy?.job_id === jobId) {
        setSelectedVacancy(null);
      }

      await fetchJobs();
      showToast('Job post deleted successfully.');
    } catch (e: any) {
      console.error(e);
      showToast(e.message || 'Failed to delete job', 'error');
    }
    setIsLoading(false);
  };

  const handleUpdateStatus = async (resumeId: string, newStatus: string, note?: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/resumes/${resumeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          decision_note: (note || '').trim(),
          decided_by: currentUser?.name || 'Admin',
        })
      });
      if (!res.ok) throw new Error('Failed to update status');
      
      showToast(`Candidate marked as ${newStatus.toUpperCase()} by ${currentUser?.name || 'Admin'}`);
      if (selectedJob) fetchResumes(selectedJob.job_id);
      fetchStats();
      setOpenDropdown(null);
    } catch (e: any) {
      showToast(e.message || 'Error updating candidate', 'error');
    }
    setIsLoading(false);
  };

  const submitDecision = async () => {
    if (!decisionModal) return;
    const note = decisionNote.trim();
    if (!note) {
      showToast('Please add a short decision description', 'error');
      return;
    }

    await handleUpdateStatus(decisionModal.resumeId, decisionModal.status, note);
    setDecisionModal(null);
    setDecisionNote('');
  };

  const handleDeleteResume = async (resumeId: string) => {
    if (!confirm('Are you sure you want to delete this candidate?')) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/resumes/${resumeId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete resume');
      
      setResumes(prev => prev.filter(r => r.resume_id !== resumeId));
      fetchStats();
      showToast('Candidate removed from pipeline.');
    } catch (e: any) {
      showToast(e.message || 'Failed to delete resume', 'error');
    }
    setIsLoading(false);
  };

  const openRemarksEditor = (resume: any) => {
    setOpenDropdown(null);
    setRemarksDraft(resume.hr_remarks || '');
    setRemarksModal({ resumeId: resume.resume_id, filename: resume.filename || 'Candidate' });
  };

  const handleSaveRemarks = async () => {
    if (!remarksModal) return;
    const value = remarksDraft.trim();
    if (!value) {
      showToast('Please add some remarks before saving', 'error');
      return;
    }

    setIsSavingRemarks(true);
    try {
      const res = await fetch(`${API_BASE}/resumes/${remarksModal.resumeId}/remarks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remarks: value }),
      });
      if (!res.ok) throw new Error('Failed to save remarks');

      setResumes(prev => prev.map(r =>
        r.resume_id === remarksModal.resumeId ? { ...r, hr_remarks: value } : r
      ));
      showToast('Remarks saved successfully');
      setRemarksModal(null);
    } catch (e: any) {
      showToast(e.message || 'Failed to save remarks', 'error');
    }
    setIsSavingRemarks(false);
  };

  const handleDeleteRemarks = async () => {
    if (!remarksModal) return;
    setIsSavingRemarks(true);
    try {
      const res = await fetch(`${API_BASE}/resumes/${remarksModal.resumeId}/remarks`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete remarks');

      setResumes(prev => prev.map(r =>
        r.resume_id === remarksModal.resumeId ? { ...r, hr_remarks: undefined } : r
      ));
      showToast('Remarks deleted');
      setRemarksModal(null);
      setRemarksDraft('');
    } catch (e: any) {
      showToast(e.message || 'Failed to delete remarks', 'error');
    }
    setIsSavingRemarks(false);
  };


  const dashboardMetrics = [
    { label: 'Total Job Openings', value: dashboardStats.total_openings, color: '#f97316', icon: <svg viewBox="0 0 24 24" fill="currentColor" width="34" height="34"><path d="M20 7h-4V5c0-1.103-.897-2-2-2h-4c-1.103 0-2 .897-2 2v2H4c-1.103 0-2 .897-2 2v10c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V9c0-1.103-.897-2-2-2zM10 5h4v2h-4V5z"/></svg> },
    { label: 'Total Application', value: dashboardStats.total_applications, color: '#facc15', icon: <svg viewBox="0 0 24 24" fill="currentColor" width="34" height="34"><path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm8 7h-5V7h5v2zm-5 4h8v2H9v-2zm0 4h8v2H9v-2z"/></svg> },
    { label: 'Shortlisted', value: dashboardStats.shortlisted, color: '#0ea5e9', icon: <svg viewBox="0 0 24 24" fill="currentColor" width="34" height="34"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg> },
    { label: 'Interviewed', value: dashboardStats.interviewed, color: '#6366f1', icon: <svg viewBox="0 0 24 24" fill="currentColor" width="34" height="34"><path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z"/></svg> },
    { label: 'Rejected', value: dashboardStats.rejected, color: '#ef4444', icon: <svg viewBox="0 0 24 24" fill="currentColor" width="34" height="34"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/><path d="M21.54 8.46l-1.41-1.41L18 9.17l-2.12-2.12-1.41 1.41L16.59 10l-2.12 2.12 1.41 1.41L18 11.41l2.12 2.12 1.41-1.41L19.41 10z"/></svg> },
    { label: 'Hired', value: dashboardStats.hired, color: '#10b981', icon: <svg viewBox="0 0 24 24" fill="currentColor" width="34" height="34"><path d="M12 1L8 5H4v4L0 12l4 3v4h4l4 4 4-4h4v-4l4-3-4-3V5h-4L12 1zm-1 15l-4-4 1.41-1.41L11 13.17l6.59-6.59L19 8l-8 8z"/></svg> },
  ];

  const interviewSchedule = (dashboardStats.recent_interviews || [])
    .filter(r => r.status === 'invited')
    .slice(0, 15);
  const vacancyCards = jobs.slice(0, 8);

  const formatSalary = (job: any) => {
    if (!job) return 'Not specified';
    const curr = job.currency || '$';
    const min = typeof job.salary_min === 'number' ? `${curr}${Math.round(job.salary_min / 1000)}K` : null;
    const max = typeof job.salary_max === 'number' ? `${curr}${Math.round(job.salary_max / 1000)}K` : null;
    if (min && max) return `${min} - ${max}`;
    return min || max || 'Not specified';
  };

  const formatJobMeta = (job: any) => {
    const employment = job?.employment_type || 'Full Time';
    const place = job?.is_remote ? 'Remote' : (job?.location || 'Onsite');
    return `${employment} • ${place}`;
  };

  const handleCarouselScroll = () => {
    if (vacancyCarouselRef.current) {
      const scrollLeft = vacancyCarouselRef.current.scrollLeft;
      const cardWidth = 320; 
      const index = Math.round(scrollLeft / cardWidth);
      if (index !== activeCardIndex && index >= 0 && index < vacancyCards.length) {
        setActiveCardIndex(index);
      }
    }
  };

  const totalResumes = dashboardStats.total_applications;
  const openJDs = jobs.length;
  const invitedCount = (dashboardStats.all_resumes || []).filter((r: any) => r.status === 'invited' || r.status === 'await' || r.status === 'completed').length;
  const hiredCount = dashboardStats.hired;

  const autoInvited = (dashboardStats.all_resumes || []).filter((r: any) => (r.score || 0) >= 0.8 && r.secure_token).length;
  const manualInvited = (dashboardStats.all_resumes || []).filter((r: any) => r.secure_token && (r.score || 0) < 0.8).length;

  const domainMap: Record<string, number> = {};
  (dashboardStats.all_resumes || []).forEach((r: any) => {
    const key = r.job_title || 'Unknown';
    domainMap[key] = (domainMap[key] || 0) + 1;
  });
  const domainEntries = Object.entries(domainMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const domainMax = domainEntries.length > 0 ? Math.max(...domainEntries.map(e => e[1])) : 1;

  const seniorityMap: Record<string, number> = {};
  (dashboardStats.all_resumes || []).forEach((r: any) => {
    const key = r.difficulty || r.parsed_criteria?.experience_level || 'Unknown';
    seniorityMap[key] = (seniorityMap[key] || 0) + 1;
  });
  const seniorityEntries = Object.entries(seniorityMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const seniorityMax = seniorityEntries.length > 0 ? Math.max(...seniorityEntries.map(e => e[1])) : 1;

  const getFilteredResumes = () => {
    return resumes.filter((r: any) => {
      if (pipelineFilter === 'all') return true;
      if (pipelineFilter === 'matched') return (r.score || 0) > 0;
      if (pipelineFilter === 'shortlisted') return ((r.score || 0) > 0.79 || !!r.secure_token) && r.status !== 'rejected';
      if (pipelineFilter === 'invited') return r.status === 'invited';
      if (pipelineFilter === 'interviewing') return r.status === 'await' || r.status === 'screened';
      if (pipelineFilter === 'completed') return r.status === 'completed';
      if (pipelineFilter === 'hired') return r.status === 'hired';
      if (pipelineFilter === 'rejected') return r.status === 'rejected';
      return true;
    });
  };

  const pipelineFilterCounts = {
    all: resumes.length,
    matched: resumes.filter((r: any) => (r.score || 0) > 0).length,
    shortlisted: resumes.filter((r: any) => ((r.score || 0) > 0.79 || !!r.secure_token) && r.status !== 'rejected').length,
    invited: resumes.filter((r: any) => r.status === 'invited').length,
    interviewing: resumes.filter((r: any) => r.status === 'await' || r.status === 'screened').length,
    completed: resumes.filter((r: any) => r.status === 'completed').length,
    hired: resumes.filter((r: any) => r.status === 'hired').length,
    rejected: resumes.filter((r: any) => r.status === 'rejected').length,
  };

  const getStageBadgeClass = (status: string) => {
    if (status === 'invited') return 'stage-badge stage-invited';
    if (status === 'hired') return 'stage-badge stage-hired';
    if (status === 'rejected') return 'stage-badge stage-rejected';
    if (status === 'await' || status === 'screened') return 'stage-badge stage-interviewing';
    if (status === 'completed') return 'stage-badge stage-completed';
    if (status === 'uploaded') return 'stage-badge stage-pending';
    return 'stage-badge stage-pending';
  };

  const getStageBadgeText = (status: string) => {
    if (status === 'invited') return 'Invited';
    if (status === 'hired') return 'Hired';
    if (status === 'rejected') return 'Rejected';
    if (status === 'await') return 'Review';
    if (status === 'screened') return 'Scored';
    if (status === 'completed') return 'Completed';
    return 'Pending';
  };

  const getResumeSkills = (r: any): string[] => {
    if (r.skills && r.skills.length > 0) return r.skills.slice(0, 3);
    if (r.parsed_criteria?.key_skills?.length > 0) return r.parsed_criteria.key_skills.slice(0, 3);
    if (r.top_skills?.length > 0) return r.top_skills.slice(0, 3);
    return [];
  };

  const libResumes = (dashboardStats.all_resumes || []).filter((r: any) => {
    const q = resumeLibSearch.toLowerCase();
    const matchSearch = !q || (r.filename || '').toLowerCase().includes(q) || (r.candidate_name || '').toLowerCase().includes(q);
    const matchDomain = !resumeLibDomain || (r.job_title || '') === resumeLibDomain;
    const matchLevel = !resumeLibLevel || (r.difficulty || r.parsed_criteria?.experience_level || '') === resumeLibLevel;
    return matchSearch && matchDomain && matchLevel;
  });

  const libDomains = [...new Set((dashboardStats.all_resumes || []).map((r: any) => r.job_title).filter(Boolean))];
  const libLevels = [...new Set((dashboardStats.all_resumes || []).map((r: any) => r.difficulty || r.parsed_criteria?.experience_level).filter(Boolean))];

  const allCandidates = (dashboardStats.all_resumes || []).filter((r: any) => r.secure_token || (r.status !== 'uploaded' && r.status));
  const filteredCandidates = allCandidates.filter((r: any) => {
    const q = candidatesSearch.toLowerCase();
    const matchSearch = !q || (r.filename || '').toLowerCase().includes(q) || (r.candidate_name || '').toLowerCase().includes(q);
    const matchStatus = !candidatesStatusFilter || r.status === candidatesStatusFilter;
    const matchJob = !candidatesJobFilter || r.job_title === candidatesJobFilter;
    return matchSearch && matchStatus && matchJob;
  });

  const getTokenStatus = (r: any) => {
    if (r.status === 'invited') return { label: 'Active', cls: 'token-badge token-active' };
    if (r.status === 'completed') return { label: 'Consumed', cls: 'token-badge token-consumed' };
    if (r.status === 'hired') return { label: 'Consumed', cls: 'token-badge token-consumed' };
    if (r.transcript && r.transcript.length > 0 && r.status === 'rejected') return { label: 'Abandoned', cls: 'token-badge token-abandoned' };
    if (r.status === 'rejected') return { label: 'Expired', cls: 'token-badge token-expired' };
    return { label: 'Pending', cls: 'token-badge token-consumed' };
  };

  const candidateJobTitles = [...new Set(allCandidates.map((r: any) => r.job_title).filter(Boolean))];

  return (
    <div className="app-shell site-theme-app">
      {toast && (
        <div className="animate-slide-up" style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 1000,
          padding: '16px 24px', borderRadius: '12px', maxWidth: '400px',
          background: toast.type === 'error' ? 'rgba(239, 68, 68, 0.95)' : 'rgba(16, 185, 129, 0.95)',
          color: 'white', fontWeight: 500, fontSize: '0.95rem',
          boxShadow: '0 8px 30px rgba(0,0,0,0.15)', backdropFilter: 'blur(10px)',
        }}>
          {toast.type === 'error' ? '❌ ' : '✅ '}{toast.msg}
        </div>
      )}

      {selectedCandidateResult && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.5)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="dashboard-vacancy-modal animate-slide-up" style={{ background: '#fff', borderRadius: '16px', border: '1px solid var(--glass-border)', width: '90%', maxWidth: '800px', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--radial-1)' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Interview Results: {selectedCandidateResult.filename}</h3>
              <button onClick={() => setSelectedCandidateResult(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
            </div>
            
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              {selectedCandidateResult.integrity_flags && selectedCandidateResult.integrity_flags.length > 0 && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', borderRadius: '8px', padding: '16px', marginBottom: '24px' }}>
                  <h4 style={{ color: 'var(--danger)', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    Integrity Violations Detected
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {selectedCandidateResult.integrity_flags.map((flag: any, i: number) => (
                      <li key={i} style={{ marginBottom: '6px' }}>{flag}</li>
                    ))}
                  </ul>
                </div>
              )}

              <h4 style={{ margin: '0 0 16px 0', fontSize: '1.1rem' }}>Interview Transcript</h4>
              
              {selectedCandidateResult.transcript && selectedCandidateResult.transcript.length > 0 ? (
                <div className="transcript-scroll-area" style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '420px', overflowY: 'auto', paddingRight: '12px' }}>
                  {selectedCandidateResult.transcript.map((msg: any, i: number) => (
                    <div key={i} style={{
                      alignSelf: msg.role === 'candidate' ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}>
                      <span style={{ fontSize: '0.7rem', color: msg.role === 'candidate' ? 'var(--primary)' : 'var(--success)', alignSelf: msg.role === 'candidate' ? 'flex-end' : 'flex-start', textTransform: 'uppercase', fontWeight: 600 }}>
                        {msg.role === 'candidate' ? '👤 Candidate' : '🤖 HIRELY.AI'}
                      </span>
                      <div style={{
                        background: msg.role === 'candidate' ? 'var(--radial-1)' : 'var(--input-bg)',
                        padding: '12px 16px', borderRadius: '12px',
                        borderBottomRightRadius: msg.role === 'candidate' ? 0 : '12px',
                        borderBottomLeftRadius: msg.role === 'agent' ? 0 : '12px',
                        border: '1px solid var(--glass-border)',
                        fontSize: '0.95rem', lineHeight: '1.5'
                      }}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No transcript data available.</div>
              )}
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => setSelectedCandidateResult(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {resumePreviewModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="dashboard-vacancy-modal animate-slide-up" style={{ background: '#fff', borderRadius: '16px', border: '1px solid var(--glass-border)', width: '92%', maxWidth: '1000px', maxHeight: '88vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--radial-1)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{resumePreviewModal.resume.candidate_name || 'Candidate'}</h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>{resumePreviewModal.resume.filename}</div>
              </div>
              <button onClick={() => setResumePreviewModal(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              {resumePreviewModal.loading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px', color: 'var(--text-muted)' }}>
                  Loading resume preview...
                </div>
              )}

              {!resumePreviewModal.loading && resumePreviewModal.mode === 'pdf' && (
                <iframe
                  src={resumePreviewModal.fileUrl}
                  title={resumePreviewModal.resume.filename || 'Resume Preview'}
                  style={{ width: '100%', height: '68vh', border: '1px solid var(--glass-border)', borderRadius: '10px', background: '#fff' }}
                />
              )}

              {!resumePreviewModal.loading && resumePreviewModal.mode === 'text' && (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  {resumePreviewModal.text}
                </pre>
              )}

              {!resumePreviewModal.loading && resumePreviewModal.mode === 'unavailable' && (
                <div style={{ minHeight: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Resume preview is not available for this candidate.
                </div>
              )}
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              {resumePreviewModal.mode === 'pdf' && (
                <a href={resumePreviewModal.fileUrl} target="_blank" rel="noreferrer" className="btn btn-outline" style={{ textDecoration: 'none' }}>
                  Open in New Tab
                </a>
              )}
              <button className="btn btn-primary" onClick={() => setResumePreviewModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {reportModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.5)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="dashboard-vacancy-modal animate-slide-up" style={{ background: '#fff', borderRadius: '16px', border: '1px solid var(--glass-border)', width: '90%', maxWidth: '800px', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0, boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }}>
            <div style={{ 
              padding: '20px 24px', borderBottom: '1px solid var(--glass-border)', 
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
              background: 'linear-gradient(135deg, rgba(185, 255, 102, 0.26), rgba(255, 255, 255, 0.85))'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ 
                  width: '36px', height: '36px', borderRadius: '10px', 
                  background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontSize: '1rem'
                }}>📊</div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem' }}>AI Evaluation Report</h3>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', marginTop: '2px', fontWeight: 600 }}>
                    {reportModal.resume.candidate_name || reportModal.resume.filename || 'Candidate'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {reportModal.resume.filename}
                  </div>
                </div>
              </div>
              <button onClick={() => setReportModal(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
            </div>
            
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              {reportModal.loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', gap: '20px' }}>
                  <div className="spinner" style={{ width: '40px', height: '40px' }} />
                  <div style={{ color: 'var(--text-muted)', fontSize: '1rem', textAlign: 'center' }}>
                    OpenAI is analyzing the interview transcript<br/>
                    <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>This may take a few seconds...</span>
                  </div>
                </div>
              ) : (
                <div style={{ 
                  whiteSpace: 'pre-wrap', 
                  lineHeight: '1.75', 
                  fontSize: '0.95rem',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-body, inherit)'
                }}>
                  {reportModal.report.split('\n').map((line: string, i: number) => {
                    if (line.startsWith('## ')) {
                      return <h3 key={i} style={{ fontSize: '1.1rem', marginTop: '20px', marginBottom: '8px', color: 'var(--primary)' }}>{line.replace('## ', '')}</h3>;
                    }
                    if (line.startsWith('# ')) {
                      return <h2 key={i} style={{ fontSize: '1.25rem', marginTop: '24px', marginBottom: '10px' }} className="text-gradient">{line.replace('# ', '')}</h2>;
                    }
                    if (line.startsWith('- ')) {
                      return <div key={i} style={{ paddingLeft: '16px', marginBottom: '4px' }}>• {line.replace('- ', '')}</div>;
                    }
                    if (line.includes('STRONG HIRE') || line.includes('HIRE')) {
                      const color = line.includes('STRONG HIRE') ? 'var(--success)' : line.includes('NO HIRE') ? 'var(--danger)' : 'var(--warning)';
                      return <div key={i} style={{ fontWeight: 700, color, fontSize: '1.05rem' }}>{line}</div>;
                    }
                    if (line.match(/Score:?\s*\d/i)) {
                      return <div key={i} style={{ fontWeight: 600, color: 'var(--primary)' }}>{line}</div>;
                    }
                    return <div key={i}>{line}</div>;
                  })}
                </div>
              )}
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              {!reportModal.loading && (
                <>
                  <button className="btn btn-outline" onClick={() => {
                    navigator.clipboard.writeText(reportModal.report).catch(() => {});
                    showToast('Report copied to clipboard!');
                  }}>
                    📋 Copy Report
                  </button>
                  <a href={getInterviewReportPdfUrl(reportModal.resume.secure_token)} className="btn btn-success" style={{ textDecoration: 'none' }}>
                    📥 Download PDF
                  </a>
                </>
              )}
              <button className="btn btn-primary" onClick={() => setReportModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {remarksModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="dashboard-vacancy-modal animate-slide-up" style={{ background: '#fff', borderRadius: '16px', border: '1px solid var(--glass-border)', width: '90%', maxWidth: '760px', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0, boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--radial-1)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Candidate Remarks</h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>{remarksModal.filename}</div>
              </div>
              <button onClick={() => setRemarksModal(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label htmlFor="candidate-remarks" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Add or edit your private HR remarks
              </label>
              <textarea
                id="candidate-remarks"
                className="input-field"
                rows={8}
                value={remarksDraft}
                onChange={(e) => setRemarksDraft(e.target.value)}
                placeholder="Write remarks about this candidate..."
                style={{ resize: 'vertical' }}
              />
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              {!!(resumes.find(r => r.resume_id === remarksModal.resumeId)?.hr_remarks || '').trim() && (
                <button className="btn btn-danger" onClick={handleDeleteRemarks} disabled={isSavingRemarks}>
                  {isSavingRemarks ? 'Deleting...' : 'Delete Remarks'}
                </button>
              )}
              <button className="btn btn-outline" onClick={() => setRemarksModal(null)} disabled={isSavingRemarks}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveRemarks} disabled={isSavingRemarks || !remarksDraft.trim()}>
                {isSavingRemarks ? 'Saving...' : 'Save Remarks'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdminModal && currentUser?.role === 'superadmin' && (
        <div className="um-modal-backdrop" onClick={() => { setShowAdminModal(false); resetAdminForm(); }}>
          <div className="um-modal animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="um-modal-header">
              <div>
                <div className="um-modal-title">{editingAdminEmail ? 'Edit User' : 'Add New User'}</div>
                <div className="um-modal-sub">Fill in the details below to {editingAdminEmail ? 'update' : 'create'} a platform user.</div>
              </div>
              <button className="um-modal-close" onClick={() => { setShowAdminModal(false); resetAdminForm(); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="um-modal-body">
              <div className="um-form-group">
                <label className="um-label">Full Name</label>
                <input className="um-input" placeholder="e.g. Jane Smith" value={adminForm.name} onChange={e => setAdminForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="um-form-group">
                <label className="um-label">Email Address</label>
                <input className="um-input" type="email" placeholder="jane@company.com" value={adminForm.email} onChange={e => setAdminForm(p => ({ ...p, email: e.target.value }))} disabled={!!editingAdminEmail} />
              </div>
              <div className="um-form-group">
                <label className="um-label">{editingAdminEmail ? 'New Password (leave blank to keep)' : 'Password'}</label>
                <input className="um-input" type="password" placeholder={editingAdminEmail ? 'Enter new password…' : 'Min. 6 characters'} value={adminForm.password} onChange={e => setAdminForm(p => ({ ...p, password: e.target.value }))} />
              </div>
              <div className="um-form-row">
                <div className="um-form-group" style={{ flex: 1 }}>
                  <label className="um-label">Role</label>
                  <select className="um-input" value={adminForm.role} onChange={e => setAdminForm(p => ({ ...p, role: e.target.value }))}>
                    <option value="admin">HR Admin</option>
                    <option value="superadmin">Super Admin</option>
                  </select>
                </div>
                <div className="um-form-group" style={{ flex: 1 }}>
                  <label className="um-label">Status</label>
                  <select className="um-input" value={adminForm.is_active ? 'active' : 'inactive'} onChange={e => setAdminForm(p => ({ ...p, is_active: e.target.value === 'active' }))}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="um-modal-footer">
              <button className="um-btn-cancel" onClick={() => { setShowAdminModal(false); resetAdminForm(); }} disabled={isAdminBusy}>Cancel</button>
              <button className="um-btn-save" onClick={saveAdmin} disabled={isAdminBusy}>
                {isAdminBusy ? 'Saving…' : (editingAdminEmail ? 'Update User' : 'Create User')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showResetPwModal && (
        <div className="um-modal-backdrop" onClick={() => { setShowResetPwModal(null); setResetPwValue(''); }}>
          <div className="um-modal" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="um-modal-header">
              <div>
                <div className="um-modal-title">Reset Password</div>
                <div className="um-modal-sub">{showResetPwModal}</div>
              </div>
              <button className="um-modal-close" onClick={() => { setShowResetPwModal(null); setResetPwValue(''); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="um-modal-body">
              <div className="um-form-group">
                <label className="um-label">New Password</label>
                <input className="um-input" type="password" placeholder="Min. 6 characters" value={resetPwValue} onChange={e => setResetPwValue(e.target.value)} autoFocus />
              </div>
            </div>
            <div className="um-modal-footer">
              <button className="um-btn-cancel" onClick={() => { setShowResetPwModal(null); setResetPwValue(''); }} disabled={isAdminBusy}>Cancel</button>
              <button className="um-btn-save" onClick={resetAdminPw} disabled={isAdminBusy || resetPwValue.trim().length < 6}>
                {isAdminBusy ? 'Saving…' : 'Reset Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {decisionModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 2100,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="dashboard-vacancy-modal animate-slide-up" style={{ background: '#fff', borderRadius: '16px', border: '1px solid var(--glass-border)', width: '90%', maxWidth: '560px', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
                {decisionModal.status === 'hired' ? 'Hire Candidate' : 'Reject Candidate'}
              </h3>
              <button onClick={() => { setDecisionModal(null); setDecisionNote(''); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
            </div>
            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                This decision will be stored as {decisionModal.status.toUpperCase()} by {currentUser?.name || 'Admin'} for {decisionModal.candidateName}.
              </div>
              <textarea
                className="input-field"
                rows={5}
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder={decisionModal.status === 'hired' ? 'Add selection description...' : 'Add rejection reason...'}
                style={{ resize: 'vertical' }}
              />
            </div>
            <div style={{ padding: '14px 22px', borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn btn-outline" onClick={() => { setDecisionModal(null); setDecisionNote(''); }}>Cancel</button>
              <button className={decisionModal.status === 'hired' ? 'btn btn-success' : 'btn btn-danger'} onClick={submitDecision} disabled={isLoading || !decisionNote.trim()}>
                {decisionModal.status === 'hired' ? 'Confirm Hire' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showJobForm && (
        <div className="dashboard-vacancy-modal-backdrop">
          <div className="dashboard-vacancy-modal animate-slide-up" style={{ background: '#fff', borderRadius: '16px', border: '1px solid var(--glass-border)', maxWidth: '600px', width: '90%', boxShadow: '0 10px 40px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', maxHeight: '90vh', padding: 0, overflow: 'hidden' }}>
            <div className="dashboard-vacancy-modal-head" style={{ padding: '20px 24px', borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}>
              <div>
                <h3>Create New Position</h3>
                <p>Post a new job description for AI candidate screening.</p>
              </div>
              <button type="button" onClick={() => setShowJobForm(false)} aria-label="Close">×</button>
            </div>
            
            <div style={{ overflowY: 'auto', padding: '24px', flex: 1, scrollbarWidth: 'none' }}>
              <form id="create-job-form" onSubmit={handleCreateJob} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <input 
                  required placeholder="Job Title" className="input-field" value={jobTitle} onChange={e => setJobTitle(e.target.value)} 
                />
                <textarea 
                  required placeholder="Job description" className="input-field" rows={5} value={jobDesc} onChange={e => setJobDesc(e.target.value)}
                  style={{ resize: 'vertical' }}
                />
                <select className="input-field" value={jobDiff} onChange={e => setJobDiff(e.target.value)}>
                  <option value="Junior">Junior Level</option>
                  <option value="Mid">Mid-Level</option>
                  <option value="Senior">Senior Level</option>
                  <option value="Lead">Lead Level</option>
                </select>
                <div className="dashboard-form-row-2">
                  <select className="input-field" value={jobType} onChange={e => setJobType(e.target.value)}>
                    <option value="Full Time">Full Time</option>
                    <option value="Part Time">Part Time</option>
                    <option value="Contract">Contract</option>
                    <option value="Internship">Internship</option>
                  </select>
                  <select className="input-field" value={jobLocation} onChange={e => {
                    setJobLocation(e.target.value);
                    setJobRemote(e.target.value === 'Remote');
                  }}>
                    <option value="Onsite">Onsite</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="Remote">Remote</option>
                  </select>
                </div>
                <div className="dashboard-form-row-2" style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '10px' }}>
                  <select 
                    className="input-field" 
                    value={jobCurrency} 
                    onChange={e => setJobCurrency(e.target.value)}
                    style={{ padding: '0 8px' }}
                  >
                    <option value="$">$ (USD)</option>
                    <option value="€">€ (EUR)</option>
                    <option value="£">£ (GBP)</option>
                    <option value="¥">¥ (JPY)</option>
                    <option value="₹">₹ (INR)</option>
                    <option value="C$">C$ (CAD)</option>
                    <option value="A$">A$ (AUD)</option>
                  </select>
                  <input
                    className="input-field"
                    type="number"
                    min={0}
                    placeholder="Salary Min"
                    value={jobSalaryMin}
                    onChange={(e) => setJobSalaryMin(e.target.value)}
                  />
                  <input
                    className="input-field"
                    type="number"
                    min={0}
                    placeholder="Salary Max"
                    value={jobSalaryMax}
                    onChange={(e) => setJobSalaryMax(e.target.value)}
                  />
                </div>
              </form>
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--glass-border)', display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px', flexShrink: 0 }}>
              <button type="button" className="btn" onClick={() => setShowJobForm(false)}>Cancel</button>
              <button type="submit" form="create-job-form" disabled={isLoading} className="btn btn-primary" style={{ width: '100%' }}>
                {isLoading ? '⏳ Processing...' : '🚀 Publish Job'}
              </button>
            </div>
          </div>
        </div>
      )}

      {metricModal && (
        <div className="dashboard-vacancy-modal-backdrop" onClick={() => { setMetricModal(null); setMetricModalSearch(''); }}>
          <div className="dashboard-vacancy-modal animate-slide-up" style={{ background: '#fff', borderRadius: '16px', border: '1px solid var(--glass-border)', maxWidth: '800px', width: '90%', padding: 0, overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
              <h3 style={{ fontSize: '1.2rem', margin: 0, flex: 1 }}>{metricModal} Details</h3>
              
              {metricModal !== 'Total Job Openings' && (
                <div style={{ position: 'relative', width: '220px' }}>
                  <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input 
                    type="text" 
                    placeholder="Search candidate..." 
                    value={metricModalSearch}
                    onChange={(e) => setMetricModalSearch(e.target.value)}
                    style={{ 
                      width: '100%', padding: '6px 12px 6px 30px', fontSize: '0.85rem', 
                      borderRadius: '8px', border: '1px solid var(--glass-border)',
                      background: 'rgba(0,0,0,0.03)'
                    }}
                  />
                </div>
              )}
              <button 
                type="button" 
                onClick={() => { setMetricModal(null); setMetricModalSearch(''); }} 
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            <div style={{ padding: '0', maxHeight: '65vh', overflowY: 'auto' }}>
              {metricModal === 'Total Job Openings' && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {jobs.map(job => (
                     <div key={job.job_id} 
                          onClick={() => { selectJob(job); setMetricModal(null); }}
                          style={{ padding: '16px 24px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'background 0.2s', background: '#fff' }}
                          onMouseOver={(e) => e.currentTarget.style.background = '#f7f8f9'}
                          onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                     >
                       <div>
                         <div style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-primary)', marginBottom: '4px' }}>{job.title}</div>
                         <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{formatJobMeta(job)} • {formatSalary(job)}</div>
                       </div>
                       <span className="badge badge-pending">{job.difficulty || 'Mid'}</span>
                     </div>
                  ))}
                  {jobs.length === 0 && <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>No jobs found.</div>}
                </div>
              )}
              {metricModal !== 'Total Job Openings' && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {(dashboardStats.all_resumes || []).filter(r => {
                      const searchStr = metricModalSearch.toLowerCase();
                      const matchSearch = !searchStr || 
                                          (r.filename && r.filename.toLowerCase().includes(searchStr)) || 
                                          (r.job_title && r.job_title.toLowerCase().includes(searchStr));
                                          
                      if (!matchSearch) return false;

                      const status = r.status;
                      if (metricModal === 'Total Application') return true;
                      if (metricModal === 'Shortlisted') return (((r.score || 0) > 0.79) || !!(r.secure_token || '').trim()) && status !== 'rejected';
                      if (metricModal === 'Interviewed') return status === 'completed';
                      if (metricModal === 'Rejected') return status === 'rejected';
                      if (metricModal === 'Hired') return status === 'hired';
                      return false;
                   }).map((resume, idx) => (
                    <div key={idx} style={{ padding: '16px 24px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                       <div style={{ flex: 1 }}>
                         <div style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-primary)', marginBottom: '4px' }}>{resume.filename}</div>
                         <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                           Role: <span style={{ color: 'var(--primary-hover)', fontWeight: 500 }}>{resume.job_title || 'General'}</span> • AI Match: {((resume.score || 0) * 100).toFixed(0)}%
                           {resume.eval_score ? ` • Ranking: ${resume.eval_score}/10` : ''}
                         </div>
                         {metricModal === 'Shortlisted' && (
                           <div style={{ fontSize: '0.78rem', color: '#059669', marginTop: '4px', fontWeight: 500 }}>
                             ✅ Shortlisted - {((resume.score || 0) > 0.79)
                               ? `AI match score ${((resume.score || 0) * 100).toFixed(0)}% exceeds threshold.`
                               : 'Interview link generated by HR.'} Strong candidate for interview.
                           </div>
                         )}
                         {metricModal === 'Rejected' && (
                           <div style={{ fontSize: '0.78rem', color: '#ef4444', marginTop: '4px', fontWeight: 600 }}>
                             {(() => {
                               const isLowScore = (resume.rejection_reason || resume.decision_note || '').toLowerCase().includes('low ai match score') || (resume.score || 0) < 0.5;
                               if (isLowScore) {
                                 return `❌ Low AI match score (${((resume.score || 0) * 100).toFixed(0)}%)`;
                               }
                               return `❌ Rejected by ${resume.status_updated_by || 'Admin'}: ${resume.decision_note || resume.rejection_reason || (() => {
                                 const reasons = [];
                                 if (resume.integrity_flags?.length > 1) reasons.push(`Suspicious behavior (${resume.integrity_flags.length} integrity alerts)`);
                                 if (resume.eval_score !== undefined && resume.eval_score < 5.0) reasons.push(`Low ranking score (${resume.eval_score}/10)`);
                                 return reasons.length > 0 ? reasons.join(' & ') : 'Did not meet hiring criteria';
                               })()}`;
                             })()}
                           </div>
                         )}
                         {metricModal === 'Hired' && (
                           <div style={{ fontSize: '0.78rem', color: '#059669', marginTop: '4px', fontWeight: 500 }}>
                             🎉 Hired by {resume.status_updated_by || 'Admin'}: {resume.decision_note || (resume.eval_score >= 8 ? `Excellent ranking score (${resume.eval_score}/10) with strong AI match.` : 'Approved by HR after review.')}
                           </div>
                         )}
                         {metricModal === 'Interviewed' && (
                           <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                             🎙️ Interview completed - {resume.eval_score ? `Ranking score: ${resume.eval_score}/10` : 'Awaiting HR review'}
                           </div>
                         )}
                       </div>
                       <span className={`badge ${resume.status === 'hired' ? 'badge-success' : resume.status === 'rejected' ? 'badge-danger' : resume.status === 'await' ? 'badge-warning' : 'badge-info'}`} style={{ flexShrink: 0, marginLeft: '12px' }}>{resume.status || 'uploaded'}</span>
                    </div>
                  ))}
                  {(dashboardStats.all_resumes || []).filter(r => {
                      const searchStr = metricModalSearch.toLowerCase();
                      const matchSearch = !searchStr || 
                                          (r.filename && r.filename.toLowerCase().includes(searchStr)) || 
                                          (r.job_title && r.job_title.toLowerCase().includes(searchStr));
                                          
                      if (!matchSearch) return false;

                      const status = r.status;
                      if (metricModal === 'Total Application') return true;
                      if (metricModal === 'Shortlisted') return (((r.score || 0) > 0.79) || !!(r.secure_token || '').trim()) && !['rejected'].includes(status);
                      if (metricModal === 'Interviewed') return status === 'completed';
                      if (metricModal === 'Rejected') return status === 'rejected';
                      if (metricModal === 'Hired') return status === 'hired';
                      return false;
                   }).length === 0 && (
                    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '12px', opacity: 0.5 }}>📭</div>
                      No candidates found for {metricModal} {metricModalSearch && 'matching search'}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'flex-end', background: 'var(--bg-layer)' }}>
               <button className="btn btn-outline" onClick={() => { setMetricModal(null); setMetricModalSearch(''); }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {selectedVacancy && (
        <div className="dashboard-vacancy-modal-backdrop">
          <div className="dashboard-vacancy-modal animate-slide-up" style={{ background: '#fff', borderRadius: '16px', border: '1px solid var(--glass-border)', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }}>
            <div className="dashboard-vacancy-modal-head">
              <div>
                <h3 style={{ fontSize: '1.4rem', color: 'var(--text-primary)' }}>{selectedVacancy.title}</h3>
                <p style={{ fontWeight: 500, color: 'var(--primary-hover)' }}>{formatJobMeta(selectedVacancy)}</p>
              </div>
              <button type="button" onClick={() => { setSelectedVacancy(null); setIsEditingJob(false); }} aria-label="Close" style={{ opacity: 0.6, fontSize: '1.8rem' }}>×</button>
            </div>
            
            <div className="dashboard-vacancy-modal-body">
              {isEditingJob ? (
                <form id="job-edit-form" onSubmit={handleEditJob} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <input 
                    required placeholder="Job Title" className="input-field" value={jobTitle} onChange={e => setJobTitle(e.target.value)} 
                  />
                  <textarea 
                    required placeholder="Job description" className="input-field" rows={5} value={jobDesc} onChange={e => setJobDesc(e.target.value)}
                    style={{ resize: 'vertical' }}
                  />
                  <select className="input-field" value={jobDiff} onChange={e => setJobDiff(e.target.value)}>
                    <option value="Junior">Junior Level</option>
                    <option value="Mid">Mid-Level</option>
                    <option value="Senior">Senior Level</option>
                    <option value="Lead">Lead Level</option>
                  </select>
                  <div className="dashboard-form-row-2">
                    <select className="input-field" value={jobType} onChange={e => setJobType(e.target.value)}>
                      <option value="Full Time">Full Time</option>
                      <option value="Part Time">Part Time</option>
                      <option value="Contract">Contract</option>
                      <option value="Internship">Internship</option>
                    </select>
                    <select className="input-field" value={jobLocation} onChange={e => {
                      setJobLocation(e.target.value);
                      setJobRemote(e.target.value === 'Remote');
                    }}>
                      <option value="Onsite">Onsite</option>
                      <option value="Hybrid">Hybrid</option>
                      <option value="Remote">Remote</option>
                    </select>
                  </div>
                  <div className="dashboard-form-row-2" style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '10px' }}>
                    <select 
                      className="input-field" 
                      value={jobCurrency} 
                      onChange={e => setJobCurrency(e.target.value)}
                      style={{ padding: '0 8px' }}
                    >
                      <option value="$">$ (USD)</option>
                      <option value="€">€ (EUR)</option>
                      <option value="£">£ (GBP)</option>
                      <option value="¥">¥ (JPY)</option>
                      <option value="₹">₹ (INR)</option>
                      <option value="C$">C$ (CAD)</option>
                      <option value="A$">A$ (AUD)</option>
                    </select>
                    <input
                      className="input-field"
                      type="number"
                      min={0}
                      placeholder="Salary Min"
                      value={jobSalaryMin}
                      onChange={(e) => setJobSalaryMin(e.target.value)}
                    />
                    <input
                      className="input-field"
                      type="number"
                      min={0}
                      placeholder="Salary Max"
                      value={jobSalaryMax}
                      onChange={(e) => setJobSalaryMax(e.target.value)}
                    />
                  </div>
                </form>
              ) : (
                <>
                  <div className="dashboard-vacancy-modal-grid">
                    <div>
                      <span>Difficulty</span>
                      <strong>{selectedVacancy.difficulty || 'General'}</strong>
                    </div>
                    <div>
                      <span>Salary Range</span>
                      <strong>{formatSalary(selectedVacancy)}</strong>
                    </div>
                    <div>
                      <span>Location</span>
                      <strong>{selectedVacancy.location || 'Remote'}</strong>
                    </div>
                    <div>
                      <span>Remote</span>
                      <strong>{selectedVacancy.is_remote ? 'Yes' : 'No'}</strong>
                    </div>
                  </div>
                  <div className="dashboard-vacancy-modal-section">
                    <h4>Job Description</h4>
                    <p>{selectedVacancy.description || 'No job description provided.'}</p>
                  </div>
                </>
              )}
            </div>

            <div className="dashboard-vacancy-modal-actions">
              {isEditingJob ? (
                <>
                  <button type="button" className="btn" onClick={() => setIsEditingJob(false)}>Cancel</button>
                  <button type="submit" form="job-edit-form" disabled={isLoading} className="btn btn-primary">
                    {isLoading ? '⏳ Saving...' : 'Save Changes'}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-outline" onClick={() => setSelectedVacancy(null)}>Close</button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ background: 'var(--bg-layer2)', color: 'var(--text-main)', border: '1px solid var(--border-light)' }}
                    onClick={() => {
                      setJobTitle(selectedVacancy.title || '');
                      setJobDesc(selectedVacancy.description || '');
                      setJobDiff(selectedVacancy.difficulty || 'Mid');
                      setJobType(selectedVacancy.employment_type || 'Full Time');
                      setJobLocation(selectedVacancy.location || 'Remote');
                      setJobSalaryMin(selectedVacancy.salary_min ? selectedVacancy.salary_min.toString() : '');
                      setJobSalaryMax(selectedVacancy.salary_max ? selectedVacancy.salary_max.toString() : '');
                      setJobRemote(selectedVacancy.is_remote ?? true);
                      setJobCurrency(selectedVacancy.currency || '$');
                      setIsEditingJob(true);
                    }}
                  >
                    Edit Job
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => handleDeleteJob(selectedVacancy.job_id)}
                    disabled={isLoading}
                  >
                    Delete Job
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <nav className="app-icon-nav">
        <div className="app-sidebar-logo">
          <span className="app-logo-chip">HB</span>
          <div className="app-sidebar-brand-wrap">
            <span className="app-sidebar-brand">Hirely.ai</span>
            <span className="app-sidebar-portal">{currentUser?.role === 'superadmin' ? 'SUPER ADMIN PORTAL' : 'ADMIN PORTAL'}</span>
          </div>
        </div>

        <div className="app-sidebar-divider" />

        <div className="app-icon-nav-top">
          <button className={`app-nav-item${activeView === 'jobs' ? ' active' : ''}`} onClick={() => setActiveView('jobs')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
            <span>Hirely.ai</span>
          </button>
          {currentUser?.role === 'superadmin' && (
            <>
              <button className={`app-nav-item${activeView === 'usermgmt' ? ' active' : ''}`} onClick={() => { setActiveView('usermgmt'); fetchAdmins(); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                <span>User Management</span>
              </button>
            </>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <div className="app-icon-nav-top" style={{ paddingBottom: 4 }}>
          <button className={`app-nav-item${activeView === 'settings' ? ' active' : ''}`} onClick={() => setActiveView('settings')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
            <span>Settings</span>
          </button>
        </div>

        <div className="app-sidebar-divider" />

        <div className="app-sidebar-model-section">
          <div className="app-sidebar-model-label">
            AI MODEL {isModelSaving && <span style={{ opacity: 0.6, fontSize: '10px' }}>saving…</span>}
          </div>
          <select
            className="app-sidebar-model-select"
            value={selectedModel}
            disabled={isModelSaving}
            onChange={async e => {
              const model = e.target.value;
              setSelectedModel(model);
              setIsModelSaving(true);
              try {
                await fetch(`${API_BASE}/settings/model`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
                  body: JSON.stringify({ model }),
                });
              } catch (_) {}
              finally { setIsModelSaving(false); }
            }}
          >
            <optgroup label="OpenAI">
              <option value="gpt-4o">GPT-4o</option>
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
            </optgroup>
            <optgroup label="Ollama Cloud (Free)">
              <option value="qwen3.5">Qwen 3.5</option>
              <option value="gemma4">Gemma 4</option>
              <option value="kimi-k2.7-code">Kimi K2.7 Code</option>
              <option value="minimax-m3">MiniMax M3</option>
            </optgroup>
          </select>
        </div>

        <div className="app-sidebar-divider" />

        <div className="app-sidebar-user">
          <div className="app-sidebar-avatar">{currentUser?.name?.[0]?.toUpperCase() || 'A'}</div>
          <div className="app-sidebar-user-info">
            <div className="app-sidebar-user-name">{currentUser?.name || 'Admin'}</div>
            {currentUser?.role === 'superadmin' && (
              <span className="app-sidebar-role-badge">SUPER ADMIN</span>
            )}
          </div>
        </div>

        <div className="app-icon-nav-top" style={{ paddingTop: 4, paddingBottom: 8 }}>
          <button
            className="app-nav-item"
            style={{ color: 'rgba(255,100,100,0.7)' }}
            onClick={() => { localStorage.removeItem('token'); router.push('/login'); }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      </nav>

      {activeView === 'settings' && (
        <div className="full-view">
          <div className="full-view-content">

            <div className="page-header-row" style={{ alignItems: 'center' }}>
              <div>
                <h1 className="page-title">Settings</h1>
                <p className="page-subtitle">Configure platform behaviour, AI parameters and screening rules</p>
              </div>
              <button className="btn-page-action" disabled={isSavingSettings} onClick={async () => {
                setIsSavingSettings(true);
                try {
                  const res = await fetch(`${API_BASE}/settings/app`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
                    body: JSON.stringify(appSettings),
                  });
                  if (!res.ok) { const e = await res.json().catch(() => ({})); showToast(e.detail || 'Failed to save', 'error'); }
                  else showToast('Settings saved successfully', 'success');
                } catch { showToast('Network error', 'error'); }
                finally { setIsSavingSettings(false); }
              }}>
                {isSavingSettings
                  ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 6, animation: 'spin 1s linear infinite' }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>Saving…</>
                  : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Save Settings</>
                }
              </button>
            </div>

            <div className="um-stats-row">
              {[
                { label: 'AI Provider', value: selectedModel.startsWith('gpt') ? 'OpenAI' : 'Ollama', color: '#4f46e5', bg: 'rgba(79,70,229,0.07)' },
                { label: 'Active Model', value: selectedModel, color: '#0284c7', bg: 'rgba(14,165,233,0.07)' },
                { label: 'Interview Duration', value: `${appSettings.interview_duration_minutes} min`, color: '#059669', bg: 'rgba(5,150,105,0.07)' },
                { label: 'Max Questions', value: `${appSettings.max_questions}`, color: '#d97706', bg: 'rgba(217,119,6,0.07)' },
              ].map(s => (
                <div key={s.label} className="um-stat-card" style={{ borderTop: `3px solid ${s.color}`, background: s.bg }}>
                  <div className="um-stat-value" style={{ color: s.color, fontSize: '1rem', fontWeight: 700 }}>{s.value}</div>
                  <div className="um-stat-label">{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>

              <div className="page-table-wrap" style={{ padding: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: '#64748b', textTransform: 'uppercase', marginBottom: 18 }}>General</div>
                <div className="um-field" style={{ marginBottom: 14 }}>
                  <label className="um-label">Company Name</label>
                  <input className="um-input" value={appSettings.company_name}
                    onChange={e => setAppSettings(s => ({ ...s, company_name: e.target.value }))} placeholder="Hirely.ai" />
                </div>
                <div className="um-field" style={{ marginBottom: 14 }}>
                  <label className="um-label">Portal Title</label>
                  <input className="um-input" value={appSettings.portal_title}
                    onChange={e => setAppSettings(s => ({ ...s, portal_title: e.target.value }))} placeholder="Admin Portal" />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderTop: '1px solid #f1f5f9' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#0f172a' }}>OTP Required by Default</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Require email OTP for new users</div>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, flexShrink: 0 }}>
                    <input type="checkbox" checked={appSettings.otp_required_default}
                      onChange={e => setAppSettings(s => ({ ...s, otp_required_default: e.target.checked }))}
                      style={{ opacity: 0, width: 0, height: 0 }} />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', inset: 0, borderRadius: 24,
                      background: appSettings.otp_required_default ? '#4f46e5' : '#cbd5e1',
                      transition: 'background .2s',
                    }}>
                      <span style={{
                        position: 'absolute', height: 18, width: 18, left: appSettings.otp_required_default ? 23 : 3, bottom: 3,
                        borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }} />
                    </span>
                  </label>
                </div>
              </div>

              <div className="page-table-wrap" style={{ padding: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: '#64748b', textTransform: 'uppercase', marginBottom: 18 }}>AI Model</div>
                <div className="um-field" style={{ marginBottom: 16 }}>
                  <label className="um-label">Active Model</label>
                  <select className="um-input" value={selectedModel} disabled={isModelSaving}
                    onChange={async e => {
                      const model = e.target.value; setSelectedModel(model); setIsModelSaving(true);
                      try {
                        await fetch(`${API_BASE}/settings/model`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
                          body: JSON.stringify({ model }),
                        });
                        showToast(`Switched to ${model}`, 'success');
                      } catch { showToast('Failed to switch model', 'error'); }
                      finally { setIsModelSaving(false); }
                    }}>
                    <optgroup label="OpenAI">
                      <option value="gpt-4o">GPT-4o</option>
                      <option value="gpt-4-turbo">GPT-4 Turbo</option>
                      <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                    </optgroup>
                    <optgroup label="Ollama Cloud (Free)">
                      <option value="qwen3.5">Qwen 3.5</option>
                      <option value="gemma4">Gemma 4</option>
                      <option value="kimi-k2.7-code">Kimi K2.7 Code</option>
                      <option value="minimax-m3">MiniMax M3</option>
                    </optgroup>
                  </select>
                </div>
                <div style={{ padding: '12px 14px', borderRadius: 10, background: selectedModel.startsWith('gpt') ? 'rgba(79,70,229,0.06)' : 'rgba(5,150,105,0.06)', border: `1px solid ${selectedModel.startsWith('gpt') ? 'rgba(79,70,229,0.15)' : 'rgba(5,150,105,0.15)'}` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: selectedModel.startsWith('gpt') ? '#4f46e5' : '#059669', marginBottom: 4 }}>
                    {selectedModel.startsWith('gpt') ? 'OpenAI Provider' : 'Ollama Cloud Provider'}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {selectedModel.startsWith('gpt') ? 'Billed per token. Best quality for complex JD parsing.' : 'Free tier. Good for screening and interview Q&A.'}
                  </div>
                </div>
              </div>

              <div className="page-table-wrap" style={{ padding: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: '#64748b', textTransform: 'uppercase', marginBottom: 18 }}>Interview</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
                  <div className="um-field">
                    <label className="um-label">Duration</label>
                    <select className="um-input" value={appSettings.interview_duration_minutes}
                      onChange={e => setAppSettings(s => ({ ...s, interview_duration_minutes: +e.target.value }))}>
                      {[10,15,20,30,45,60,90,120].map(v => <option key={v} value={v}>{v} min</option>)}
                    </select>
                  </div>
                  <div className="um-field">
                    <label className="um-label">Max Questions</label>
                    <select className="um-input" value={appSettings.max_questions}
                      onChange={e => setAppSettings(s => ({ ...s, max_questions: +e.target.value }))}>
                      {[3,5,7,8,10,12,15,20].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Auto-Status Thresholds (out of 10)</div>
                {[
                  { key: 'hire_score_threshold', label: 'Hire', color: '#059669', bg: 'rgba(5,150,105,0.08)' },
                  { key: 'await_score_threshold', label: 'Await', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
                  { key: 'reject_score_threshold', label: 'Reject', color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
                ].map(({ key, label, color, bg }) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: bg, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 40 }}>{label}</span>
                    <input type="range" min={0} max={10} step={0.5} value={(appSettings as any)[key]}
                      onChange={e => setAppSettings(s => ({ ...s, [key]: +e.target.value }))}
                      style={{ flex: 1, accentColor: color }} />
                    <span style={{ fontSize: 13, fontWeight: 800, color, minWidth: 28, textAlign: 'right' }}>{(appSettings as any)[key]}</span>
                  </div>
                ))}
              </div>

              <div className="page-table-wrap" style={{ padding: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: '#64748b', textTransform: 'uppercase', marginBottom: 18 }}>Resume Screening</div>
                {[
                  { key: 'screening_shortlist_threshold', label: 'Shortlist threshold', desc: 'Resumes above this score are shortlisted', color: '#059669' },
                  { key: 'screening_reject_threshold', label: 'Auto-reject threshold', desc: 'Resumes below this score are auto-rejected', color: '#dc2626' },
                ].map(({ key, label, desc, color }) => (
                  <div key={key} style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{label}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{desc}</div>
                      </div>
                      <span style={{ fontSize: 20, fontWeight: 800, color }}>{Math.round((appSettings as any)[key] * 100)}%</span>
                    </div>
                    <input type="range" min={0} max={1} step={0.01} value={(appSettings as any)[key]}
                      onChange={e => setAppSettings(s => ({ ...s, [key]: +e.target.value }))}
                      style={{ width: '100%', accentColor: color, marginTop: 4 }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>
                      <span>0%</span><span>50%</span><span>100%</span>
                    </div>
                  </div>
                ))}
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', fontSize: 12, color: '#92400e', marginTop: 4 }}>
                  Resumes between the two thresholds are marked <strong>Await</strong> for manual HR review.
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {activeView === 'resumes' && (
        <div className="full-view">
          <div className="full-view-content">
            <div className="page-header-row">
              <div>
                <h1 className="page-title">Resume Library</h1>
                <p className="page-subtitle">All uploaded resumes · AI-classified and matched to jobs</p>
              </div>
              <button className="btn-page-action" onClick={() => { setActiveView('jobs'); setActiveTab('upload'); }}>Upload Resume</button>
            </div>
            <div className="page-filters-row">
              <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#999', pointerEvents: 'none' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input className="page-filter-input" placeholder="Search by name, email or skills..." value={resumeLibSearch} onChange={e => setResumeLibSearch(e.target.value)} />
              </div>
              <select className="page-filter-select" value={resumeLibDomain} onChange={e => setResumeLibDomain(e.target.value)}>
                <option value="">All Domains</option>
                {libDomains.map((d: any) => <option key={d} value={d}>{d}</option>)}
              </select>
              <select className="page-filter-select" value={resumeLibLevel} onChange={e => setResumeLibLevel(e.target.value)}>
                <option value="">All Levels</option>
                {libLevels.map((l: any) => <option key={l} value={l}>{l}</option>)}
              </select>
              <span className="page-count">{libResumes.length} resumes</span>
            </div>
            <div className="page-table-wrap">
              <table className="page-table">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Domain</th>
                    <th>Level</th>
                    <th>Top Skills</th>
                    <th>Exp</th>
                    <th>Match</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {libResumes.map((r: any, i: number) => (
                    <tr key={r.resume_id || i}>
                      <td>
                        <div className="lib-name">{r.candidate_name || r.filename || 'Candidate'}</div>
                        <div className="lib-sub">{r.filename}</div>
                      </td>
                      <td style={{ color: '#555', fontSize: '0.85rem' }}>{r.job_title || '-'}</td>
                      <td style={{ color: '#555', fontSize: '0.85rem' }}>{r.difficulty || r.parsed_criteria?.experience_level || '-'}</td>
                      <td>
                        {getResumeSkills(r).map((sk: string, si: number) => (
                          <span key={si} className="skill-tag">{sk}</span>
                        ))}
                      </td>
                      <td style={{ color: '#555', fontSize: '0.85rem' }}>{r.parsed_criteria?.years_experience || '-'}</td>
                      <td style={{ fontWeight: 700, color: (r.score || 0) > 0.75 ? '#059669' : (r.score || 0) > 0.5 ? '#d97706' : '#dc2626' }}>{r.score ? `${(r.score * 100).toFixed(0)}%` : '-'}</td>
                      <td><span className={getStageBadgeClass(r.status)}>{getStageBadgeText(r.status)}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button className="action-icon-btn" title="View Resume" onClick={() => handleViewResume(r)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          </button>
                          <button className="action-icon-btn danger" title="Delete" onClick={() => handleDeleteResume(r.resume_id)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {libResumes.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: '#aaa' }}>No resumes found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeView === 'candidates' && (
        <div className="full-view">
          <div className="full-view-content">
            <div className="page-header-row">
              <div>
                <h1 className="page-title">Candidates</h1>
                <p className="page-subtitle">Manage interview invites, track pipeline stages, and record decisions</p>
              </div>
              <button className="btn-page-action" onClick={() => setActiveView('jobs')}>+ Invite Candidate</button>
            </div>
            <div className="page-filters-row">
              <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#999', pointerEvents: 'none' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input className="page-filter-input" placeholder="Search candidates..." value={candidatesSearch} onChange={e => setCandidatesSearch(e.target.value)} />
              </div>
              <select className="page-filter-select" value={candidatesStatusFilter} onChange={e => setCandidatesStatusFilter(e.target.value)}>
                <option value="">All Statuses</option>
                <option value="invited">Invited</option>
                <option value="await">Review</option>
                <option value="completed">Completed</option>
                <option value="hired">Hired</option>
                <option value="rejected">Rejected</option>
              </select>
              <select className="page-filter-select" value={candidatesJobFilter} onChange={e => setCandidatesJobFilter(e.target.value)}>
                <option value="">All Jobs</option>
                {candidateJobTitles.map((t: any) => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="page-count">{filteredCandidates.length} candidates</span>
            </div>
            <div className="page-table-wrap">
              <table className="page-table">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Stage</th>
                    <th>Score</th>
                    <th>Invite Type</th>
                    <th>Token</th>
                    <th>Invited</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.map((r: any, i: number) => {
                    const tokenSt = getTokenStatus(r);
                    const isAuto = (r.score || 0) >= 0.8 && r.secure_token;
                    return (
                      <tr key={r.resume_id || i}>
                        <td>
                          <div className="lib-name">{r.candidate_name || r.filename || 'Candidate'}</div>
                          <div className="lib-sub">{r.job_title || ''}</div>
                        </td>
                        <td><span className={getStageBadgeClass(r.status)}>{getStageBadgeText(r.status)}</span></td>
                        <td style={{ fontWeight: 700, color: (r.score || 0) > 0.75 ? '#059669' : (r.score || 0) > 0.5 ? '#d97706' : '#dc2626' }}>{r.score ? `${(r.score * 100).toFixed(0)}%` : '-'}</td>
                        <td><span className={isAuto ? 'invite-auto' : 'invite-manual'}>{isAuto ? 'Auto' : 'Manual'}</span></td>
                        <td><span className={tokenSt.cls}>{tokenSt.label}</span></td>
                        <td style={{ fontSize: '0.8rem', color: '#888' }}>{r.invited_by ? `by ${r.invited_by}` : '-'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button className="action-icon-btn" title="View Resume" onClick={() => handleViewResume(r)}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            </button>
                            {r.secure_token && (
                              <button className="action-icon-btn" title="Copy Interview Link" onClick={() => { const link = `${window.location.origin}/interview/${r.secure_token}`; navigator.clipboard.writeText(link).catch(() => {}); showToast('Link copied!'); }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                              </button>
                            )}
                            <button className="action-icon-btn" title="Re-invite" onClick={() => generateInterviewLink(r)} disabled={isInvitingId === r.resume_id}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredCandidates.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: '#aaa' }}>No candidates found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeView === 'usermgmt' && currentUser?.role === 'superadmin' && (() => {
        const umTotal = admins.length;
        const umSuper = admins.filter((a: any) => a.role === 'superadmin').length;
        const umHR = admins.filter((a: any) => a.role === 'admin').length;
        const umActive = admins.filter((a: any) => a.is_active !== false).length;
        const avatarPalette = ['#191a23','#6ba920','#0284c7','#d97706','#059669','#dc2626','#7c3aed'];
        const getAvatarBg = (name: string) => avatarPalette[(name?.charCodeAt(0) || 65) % avatarPalette.length];
        const getRoleMeta = (role: string) => {
          if (role === 'superadmin') return { label: 'Super Admin', cls: 'um-badge-super' };
          if (role === 'admin') return { label: 'HR Admin', cls: 'um-badge-admin' };
          return { label: 'Standard', cls: 'um-badge-std' };
        };
        const fmtDate = (d: string) => {
          if (!d) return '-';
          try { return new Date(d).toLocaleDateString('en-GB'); } catch { return '-'; }
        };
        return (
          <div className="full-view">
            <div className="full-view-content">

              <div className="page-header-row" style={{ alignItems: 'center' }}>
                <div>
                  <h1 className="page-title">User Management</h1>
                  <p className="page-subtitle">Manage platform users, roles, and access</p>
                </div>
                <button className="btn-page-action" onClick={openAdminCreate}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add User
                </button>
              </div>

              <div className="um-stats-row">
                {[
                  { value: umTotal, label: 'Total Users', color: '#191a23', bg: 'rgba(25,26,35,0.06)' },
                  { value: umSuper, label: 'Super Admins', color: '#6ba920', bg: 'rgba(107,169,32,0.08)' },
                  { value: umHR, label: 'HR Admins', color: '#0284c7', bg: 'rgba(14,165,233,0.08)' },
                  { value: umActive, label: 'Active', color: '#059669', bg: 'rgba(16,185,129,0.08)' },
                ].map(s => (
                  <div key={s.label} className="um-stat-card" style={{ borderTop: `3px solid ${s.color}` }}>
                    <div className="um-stat-value" style={{ color: s.color }}>{s.value}</div>
                    <div className="um-stat-label">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="page-table-wrap">
                <table className="page-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>OTP</th>
                      <th>Last Login</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {admins.map((admin: any) => {
                      const roleMeta = getRoleMeta(admin.role);
                      const initial = (admin.name || admin.email || '?')[0].toUpperCase();
                      const isMe = admin.email === currentUser?.email;
                      return (
                        <tr key={admin._id || admin.email}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <div className="um-avatar" style={{ background: getAvatarBg(admin.name || admin.email) }}>{initial}</div>
                              <div>
                                <div className="lib-name">{admin.name || '-'} {isMe && <span className="um-you-tag">you</span>}</div>
                                <div className="lib-sub">{admin.email}</div>
                              </div>
                            </div>
                          </td>
                          <td><span className={`um-badge ${roleMeta.cls}`}>{roleMeta.label}</span></td>
                          <td>
                            <span className={`um-badge ${admin.is_active !== false ? 'um-badge-active' : 'um-badge-inactive'}`}>
                              {admin.is_active !== false ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td>
                            <span className={`um-badge ${admin.otp_enabled ? 'um-badge-otp-on' : 'um-badge-otp-off'}`}>
                              {admin.otp_enabled ? 'On' : 'Off'}
                            </span>
                          </td>
                          <td style={{ color: '#666', fontSize: '0.85rem' }}>{fmtDate(admin.last_login)}</td>
                          <td>
                            <div className="um-actions">
                              {!isMe && (
                                <>
                                  <button className="um-action-btn" onClick={() => { openAdminEdit(admin); setShowAdminModal(true); }} disabled={isAdminBusy}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    Edit
                                  </button>
                                  <button className="um-action-btn" onClick={() => { setShowResetPwModal(admin.email); setResetPwValue(''); }} disabled={isAdminBusy}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                    Reset PW
                                  </button>
                                  {admin.role !== 'superadmin' && (
                                    <button className="um-action-btn danger" onClick={() => deleteAdmin(admin.email)} disabled={isAdminBusy}>
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                                      Delete
                                    </button>
                                  )}
                                </>
                              )}
                              {isMe && <span style={{ fontSize: '0.78rem', color: '#bbb' }}>-</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {admins.length === 0 && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', padding: '48px', color: '#aaa' }}>No users found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {activeView === 'jobs' && (
        <>
          <div className="jd-sidebar">
            <div className="jd-sidebar-header">
              <h2>Job Descriptions</h2>
              <button className="btn-new-jd" onClick={() => { setJobTitle(''); setJobDesc(''); setJobDiff('Mid'); setJobType('Full Time'); setJobLocation('Remote'); setJobSalaryMin('100000'); setJobSalaryMax('200000'); setJobRemote(true); setJobCurrency('$'); setShowJobForm(true); }}>+ New JD</button>
            </div>
            <div className="jd-sidebar-stats">
              <div className="jd-stat-card">
                <div className="jd-stat-value">{totalResumes}</div>
                <div className="jd-stat-label">Resumes</div>
              </div>
              <div className="jd-stat-card">
                <div className="jd-stat-value accent">{openJDs}</div>
                <div className="jd-stat-label">Open JDs</div>
              </div>
              <div className="jd-stat-card">
                <div className="jd-stat-value">{invitedCount}</div>
                <div className="jd-stat-label">Invited</div>
              </div>
              <div className="jd-stat-card">
                <div className="jd-stat-value">{hiredCount}</div>
                <div className="jd-stat-label">Hired</div>
              </div>
            </div>
            <div className="jd-sidebar-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" placeholder="Search jobs..." value={jobSearchTerm} onChange={e => setJobSearchTerm(e.target.value)} />
            </div>
            <div className="jd-job-list">
              {jobs.filter(j => (j.title || '').toLowerCase().includes(jobSearchTerm.toLowerCase())).map(job => (
                <div key={job.job_id} className={`jd-job-item${selectedJob?.job_id === job.job_id ? ' active' : ''}`} onClick={() => selectJob(job)}>
                  <div className="jd-job-item-row">
                    <div className="jd-job-item-title">{job.title}</div>
                    <div className="jd-job-item-actions">
                      <button
                        className="jd-job-action-btn"
                        title="Edit job"
                        onClick={e => openJobEdit(e, job)}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button
                        className="jd-job-action-btn danger"
                        title="Delete job"
                        onClick={e => { e.stopPropagation(); handleDeleteJob(job.job_id); }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                      </button>
                    </div>
                  </div>
                  <div className="jd-job-item-meta">{job.employment_type || 'Full Time'} · {job.location || 'Remote'}</div>
                  <div className="jd-job-item-count">{job.applied_count || 0} candidates</div>
                </div>
              ))}
              {jobs.length === 0 && (
                <div style={{ padding: '24px 20px', color: '#aaa', fontSize: '0.85rem', textAlign: 'center' }}>No jobs yet. Create one to get started.</div>
              )}
            </div>
          </div>

          <div className="jd-content">
            <div className="jd-content-inner">
              {!selectedJob ? (
                <>
                  <div className="jd-hero-banner">
                    <div className="jd-hero-body">
                      <span className="jd-hero-label">RESUME INTELLIGENCE</span>
                      <h1>Your hiring pipeline at a glance</h1>
                      <p>Select a job description from the sidebar to review candidates, or create a new one to get started.</p>
                      <button className="jd-hero-create-btn" onClick={() => { setJobTitle(''); setJobDesc(''); setJobDiff('Mid'); setJobType('Full Time'); setJobLocation('Remote'); setJobSalaryMin('100000'); setJobSalaryMax('200000'); setJobRemote(true); setJobCurrency('$'); setShowJobForm(true); }}>+ Create New JD</button>
                    </div>
                    <div className="jd-hero-stat">
                      <div className="jd-hero-stat-num">{totalResumes}</div>
                      <div className="jd-hero-stat-label">RESUMES IN POOL</div>
                    </div>
                  </div>

                  <div className="jd-funnel-card">
                    <div className="jd-funnel-header">
                      <h3>INVITE FUNNEL</h3>
                      <span>Candidate progression through the hiring pipeline</span>
                    </div>
                    <div className="jd-funnel-steps">

                      <div className="jd-funnel-step">
                        <div className="jd-funnel-step-icon" style={{ background: 'rgba(25,26,35,0.07)' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#191a23" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        </div>
                        <div className="jd-funnel-step-value" style={{ color: '#191a23' }}>{totalResumes}</div>
                        <div className="jd-funnel-step-label" style={{ color: '#191a23' }}>Total Resumes</div>
                      </div>

                      <div className="jd-funnel-arrow">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </div>

                      <div className="jd-funnel-step">
                        <div className="jd-funnel-step-icon" style={{ background: 'rgba(14,165,233,0.1)' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        </div>
                        <div className="jd-funnel-step-value" style={{ color: '#0284c7' }}>{autoInvited}</div>
                        <div className="jd-funnel-step-label" style={{ color: '#0284c7' }}>Auto-Invited</div>
                      </div>

                      <div className="jd-funnel-arrow">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </div>

                      <div className="jd-funnel-step">
                        <div className="jd-funnel-step-icon" style={{ background: 'rgba(107,169,32,0.1)' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6ba920" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                        </div>
                        <div className="jd-funnel-step-value" style={{ color: '#6ba920' }}>{manualInvited}</div>
                        <div className="jd-funnel-step-label" style={{ color: '#6ba920' }}>Manually Invited</div>
                      </div>

                      <div className="jd-funnel-arrow">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </div>

                      <div className="jd-funnel-step">
                        <div className="jd-funnel-step-icon" style={{ background: 'rgba(245,158,11,0.1)' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        </div>
                        <div className="jd-funnel-step-value" style={{ color: '#d97706' }}>{dashboardStats?.interviewed ?? 0}</div>
                        <div className="jd-funnel-step-label" style={{ color: '#d97706' }}>Interviewed</div>
                      </div>

                      <div className="jd-funnel-arrow">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </div>

                      <div className="jd-funnel-step">
                        <div className="jd-funnel-step-icon" style={{ background: 'rgba(16,185,129,0.1)' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>
                        </div>
                        <div className="jd-funnel-step-value" style={{ color: '#059669' }}>{dashboardStats?.hired ?? 0}</div>
                        <div className="jd-funnel-step-label" style={{ color: '#059669' }}>Hired</div>
                      </div>

                    </div>
                  </div>

                  <div className="jd-charts-row">
                    <div className="jd-chart-card">
                      <h3>BY DOMAIN</h3>
                      {domainEntries.length === 0 && <div style={{ color: '#aaa', fontSize: '0.85rem' }}>No data yet.</div>}
                      {domainEntries.map(([label, count]) => (
                        <div key={label} className="jd-chart-bar-row">
                          <div className="jd-chart-bar-label">{label}</div>
                          <div className="jd-chart-bar-track">
                            <div className="jd-chart-bar-fill" style={{ width: `${(count / domainMax) * 100}%`, background: '#6d28d9' }} />
                          </div>
                          <div className="jd-chart-bar-count">{count}</div>
                        </div>
                      ))}
                    </div>
                    <div className="jd-chart-card">
                      <h3>BY SENIORITY</h3>
                      {seniorityEntries.length === 0 && <div style={{ color: '#aaa', fontSize: '0.85rem' }}>No data yet.</div>}
                      {seniorityEntries.map(([label, count]) => (
                        <div key={label} className="jd-chart-bar-row">
                          <div className="jd-chart-bar-label">{label}</div>
                          <div className="jd-chart-bar-track">
                            <div className="jd-chart-bar-fill" style={{ width: `${(count / seniorityMax) * 100}%`, background: '#0284c7' }} />
                          </div>
                          <div className="jd-chart-bar-count">{count}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="jd-tabs">
                    <button className={`jd-tab-btn${activeTab === 'pipeline' ? ' active' : ''}`} onClick={() => setActiveTab('pipeline')}>Candidate Pipeline</button>
                    <button className={`jd-tab-btn${activeTab === 'details' ? ' active' : ''}`} onClick={() => setActiveTab('details')}>Job Details</button>
                    <button className={`jd-tab-btn${activeTab === 'upload' ? ' active' : ''}`} onClick={() => setActiveTab('upload')}>Upload Resumes</button>
                  </div>

                  {activeTab === 'pipeline' && (
                    <div>
                      <h2 className="jd-pipeline-title">{selectedJob.title} - Pipeline ({resumes.length})</h2>
                      <div className="jd-pipeline-filters">
                        {(['all', 'matched', 'shortlisted', 'invited', 'interviewing', 'completed', 'hired', 'rejected'] as const).map(f => (
                          <button key={f} className={`jd-filter-btn${pipelineFilter === f ? ' active' : ''}`} onClick={() => setPipelineFilter(f)}>
                            {f.charAt(0).toUpperCase() + f.slice(1)} {pipelineFilterCounts[f]}
                          </button>
                        ))}
                      </div>
                      <div className="jd-table-wrap">
                        <table className="jd-table pip-table">
                          <thead>
                            <tr>
                              <th>Candidate</th>
                              <th>Stage</th>
                              <th>Score</th>
                              <th>Skills</th>
                              <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {getFilteredResumes().sort((a: any, b: any) => {
                              const aRank = typeof a.eval_score === 'number' ? a.eval_score : -1;
                              const bRank = typeof b.eval_score === 'number' ? b.eval_score : -1;
                              if (bRank !== aRank) return bRank - aRank;
                              return (b.score || 0) - (a.score || 0);
                            }).map((r: any) => {
                              const scoreVal = r.score || 0;
                              const scorePct = Math.round(scoreVal * 100);
                              const scoreColor = scoreVal > 0.75 ? '#059669' : scoreVal > 0.5 ? '#d97706' : scoreVal > 0 ? '#dc2626' : '#ccc';
                              const initial = (r.candidate_name || r.filename || '?')[0].toUpperCase();
                              const avatarColors = ['#191a23','#6ba920','#0284c7','#d97706','#059669','#7c3aed'];
                              const avatarBg = avatarColors[(initial.charCodeAt(0) || 65) % avatarColors.length];
                              return (
                              <tr key={r.resume_id} className="pip-row">
                                <td className="pip-candidate-td">
                                  <div className="pip-candidate-cell">
                                    <div className="pip-avatar" style={{ background: avatarBg }}>{initial}</div>
                                    <div>
                                      <button type="button" className="pip-name-btn" onClick={() => handleViewResume(r)}>
                                        {r.candidate_name || 'Candidate'}
                                      </button>
                                      <div className="pip-sub">{r.job_title || ''}{r.difficulty ? ` · ${r.difficulty}` : ''}</div>
                                    </div>
                                  </div>
                                </td>
                                <td><span className={getStageBadgeClass(r.status)}>{getStageBadgeText(r.status)}</span></td>
                                <td>
                                  {scoreVal > 0 ? (
                                    <div className="pip-score-cell">
                                      <div className="pip-score-ring" style={{ '--score-color': scoreColor, '--score-pct': `${scorePct}` } as React.CSSProperties}>
                                        <span className="pip-score-num" style={{ color: scoreColor }}>{scorePct}%</span>
                                      </div>
                                    </div>
                                  ) : <span style={{ color: '#ccc', fontSize: '0.82rem' }}>-</span>}
                                </td>
                                <td>
                                  {getResumeSkills(r).map((sk: string, si: number) => (
                                    <span key={si} className="skill-tag">{sk}</span>
                                  ))}
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  <div className="pipeline-actions" style={{ justifyContent: 'flex-end' }}>
                                    <button className="pip-icon-btn" title="View Resume" onClick={() => handleViewResume(r)}>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                    </button>

                                    {r.status !== 'completed' && r.status !== 'invited' && r.status !== 'hired' && r.status !== 'rejected' && (
                                      <button className="pip-icon-btn" title={isInvitingId === r.resume_id ? 'Creating…' : 'Create Interview Link'} onClick={() => generateInterviewLink(r)} disabled={isInvitingId === r.resume_id}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                                      </button>
                                    )}

                                    {r.status === 'invited' && r.secure_token && (
                                      <button className={`pip-icon-btn${copiedId === r.resume_id ? ' copied' : ''}`} title={copiedId === r.resume_id ? 'Copied!' : 'Copy Interview Link'} onClick={() => { const link = `${window.location.origin}/interview/${r.secure_token}`; navigator.clipboard.writeText(link).catch(() => {}); setCopiedId(r.resume_id); setTimeout(() => setCopiedId(null), 3000); }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                      </button>
                                    )}

                                    {(r.status === 'invited' || (r.status === 'rejected' && (!!r.report || !!(Array.isArray(r.transcript) && r.transcript.length > 0) || typeof r.eval_score === 'number'))) && (
                                      <button className="pip-icon-btn" title={isInvitingId === r.resume_id ? 'Re-inviting…' : 'Re-invite'} onClick={() => generateInterviewLink(r)} disabled={isInvitingId === r.resume_id}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.6"/></svg>
                                      </button>
                                    )}

                                    {(r.status === 'completed' || r.status === 'hired' || r.status === 'rejected') && (
                                      <button className="pip-icon-btn" title="View Results" onClick={() => handleViewResults(r)}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                                      </button>
                                    )}

                                    {(r.status === 'completed' || r.status === 'hired' || r.status === 'rejected') && (
                                      <button className="pip-icon-btn" title="Generate AI Report" onClick={() => handleGenerateReport(r)}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                                      </button>
                                    )}

                                    {(r.status === 'completed' || r.report) && (
                                      <a className="pip-icon-btn" title="Download PDF" href={getInterviewReportPdfUrl(r.secure_token)} target="_blank" rel="noreferrer">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                      </a>
                                    )}

                                    <button className="pip-icon-btn" title={r.hr_remarks ? 'Edit Remarks' : 'Add Remarks'} onClick={() => openRemarksEditor(r)}>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                    </button>

                                    {r.status === 'await' && (
                                      <button className="pip-icon-btn hire" title="Hire Candidate" onClick={() => setDecisionModal({ resumeId: r.resume_id, status: 'hired', candidateName: r.candidate_name || r.filename || 'Candidate' })}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                      </button>
                                    )}

                                    {r.status === 'await' && (
                                      <button className="pip-icon-btn reject" title="Reject Candidate" onClick={() => setDecisionModal({ resumeId: r.resume_id, status: 'rejected', candidateName: r.candidate_name || r.filename || 'Candidate' })}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                      </button>
                                    )}

                                    <button className="pip-icon-btn delete" title="Delete Candidate" onClick={() => handleDeleteResume(r.resume_id)}>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                              );
                            })}
                            {getFilteredResumes().length === 0 && (
                              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '48px', color: '#bbb' }}>No candidates match this filter.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {activeTab === 'details' && (
                    <div>
                      <h1 className="jd-details-title">{selectedJob.title}</h1>
                      <div className="jd-tag-row">
                        {selectedJob.employment_type && <span className="jd-tag">{selectedJob.employment_type}</span>}
                        {selectedJob.difficulty && <span className="jd-tag">{selectedJob.difficulty}</span>}
                        {selectedJob.is_remote && <span className="jd-tag green">Remote</span>}
                        {selectedJob.location && !selectedJob.is_remote && <span className="jd-tag">{selectedJob.location}</span>}
                      </div>
                      <div className="jd-meta-row">
                        {selectedJob.location && <span>📍 {selectedJob.location}</span>}
                        {(selectedJob.salary_min || selectedJob.salary_max) && <span>$ {formatSalary(selectedJob)}</span>}
                      </div>
                      <p className="jd-section-header">DESCRIPTION</p>
                      <p className="jd-description">{selectedJob.description || 'No description provided.'}</p>
                      <hr className="jd-divider" />
                      <p className="jd-section-header">AI-PARSED CRITERIA</p>
                      {selectedJob.parsed_criteria && Object.keys(selectedJob.parsed_criteria).length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {Object.entries(selectedJob.parsed_criteria).map(([key, val]: [string, any]) => (
                            <div key={key} style={{ display: 'flex', gap: '12px', fontSize: '0.88rem' }}>
                              <span style={{ fontWeight: 600, color: '#191a23', minWidth: '160px', textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</span>
                              <span style={{ color: '#555' }}>{Array.isArray(val) ? val.join(', ') : String(val)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="jd-criteria-empty">AI is parsing criteria - check back shortly after creating the job.</p>
                      )}
                    </div>
                  )}

                  {activeTab === 'upload' && (
                    <div className="jd-upload-area">
                      <h2 className="jd-upload-title">Bulk Resume Upload</h2>
                      <p className="jd-upload-subtitle">Upload up to 500 PDF or DOCX resumes. AI processing starts automatically in the background.</p>
                      <div
                        className={`jd-dropzone${dragActive ? ' active' : ''}`}
                        onDragOver={e => { e.preventDefault(); setDragActive(true); }}
                        onDragLeave={() => setDragActive(false)}
                        onDrop={e => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files.length > 0) setFiles(e.dataTransfer.files); }}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <div className="jd-dropzone-icon">
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
                        </div>
                        <div className="jd-dropzone-text">Drag &amp; drop files here, or click to browse</div>
                        <div className="jd-dropzone-hint">PDF, DOC, DOCX supported</div>
                        {files && files.length > 0 && (
                          <div style={{ marginTop: '12px', fontSize: '0.85rem', color: '#6d28d9', fontWeight: 600 }}>{files.length} file{files.length !== 1 ? 's' : ''} selected</div>
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        style={{ display: 'none' }}
                        onChange={e => setFiles(e.target.files)}
                      />
                      <button
                        className="jd-upload-btn"
                        disabled={!files || files.length === 0 || isLoading}
                        onClick={async (e) => {
                          if (!files || files.length === 0 || !selectedJob) return;
                          setIsLoading(true);
                          const formData = new FormData();
                          for (let i = 0; i < files.length; i++) formData.append('files', files[i]);
                          try {
                            const res = await fetch(`${API_BASE}/resumes/upload/${selectedJob.job_id}`, { method: 'POST', body: formData });
                            if (res.ok) {
                              const data = await res.json();
                              showToast(data.message || 'Resumes uploaded! Automatically starting AI screening...');
                              await handleScreenResumes();
                            }
                            setFiles(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                            await fetchResumes(selectedJob.job_id);
                            await fetchJobs();
                            setActiveTab('pipeline');
                          } catch (err) {
                            showToast('Upload failed', 'error');
                          }
                          setIsLoading(false);
                        }}
                      >
                        {isLoading ? 'Uploading...' : `Upload ${files ? files.length : 0} file${(files?.length || 0) !== 1 ? 's' : ''}`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
