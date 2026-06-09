'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { updateMyProfile, changeMyPassword, fetchMyProfile } from '@/lib/api';
import {
    User,
    Mail,
    Phone,
    Lock,
    Bell,
    CheckCircle,
    AlertCircle,
    Eye,
    EyeOff,
    Save,
    RefreshCw,
} from 'lucide-react';

export default function ProfilePage() {
    const { user, loading, logout } = useAuth();
    const typedUser = user as {
        username?: string;
        email?: string;
        role?: string;
        id?: string;
        assignedRegionId?: number | null;
    } | null;

    // ---------------------------------------------------------------------------
    // Profile form state
    // ---------------------------------------------------------------------------
    const [profileForm, setProfileForm] = useState({ first_name: '', last_name: '', email: '', current_password: '', contact_number: '' });
    const [currentProfile, setCurrentProfile] = useState<{ first_name: string; last_name: string; email?: string; contact_number: string } | null>(null);
    const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [savingProfile, setSavingProfile] = useState(false);
    const [contactTouched, setContactTouched] = useState(false);

    // Notification preferences state
    const [notifPrefs, setNotifPrefs] = useState({ email_opt_in: true, push_opt_in: true });
    const [notifMsg, setNotifMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [savingNotif, setSavingNotif] = useState(false);

    // Philippine phone validation: starts with 09, followed by 9 digits (total 11)
    const isPhoneValid = (val: string) => {
        if (!val) return true;
        return /^09\d{9}$/.test(val);
    };

    // ---------------------------------------------------------------------------
    // Password form state
    // ---------------------------------------------------------------------------
    const [pwdForm, setPwdForm] = useState({ current_password: '', new_password: '', confirm_password: '', otp_code: '' });
    const [showCurrentPwd, setShowCurrentPwd] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [pwdMsg, setPwdMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [savingPwd, setSavingPwd] = useState(false);

    // Fetch profile details
    useEffect(() => {
        if (!loading && user) {
            fetchMyProfile().then(data => {
                setCurrentProfile({
                    first_name: data.first_name,
                    last_name: data.last_name,
                    email: data.email,
                    contact_number: data.contact_number,
                });
                setNotifPrefs({
                    email_opt_in: data.email_opt_in ?? true,
                    push_opt_in: data.push_opt_in ?? true,
                });
            }).catch(e => console.error("Failed to fetch profile", e));
        }
    }, [user, loading]);

    // ---------------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------------
    const handleSaveProfile = async () => {
        setSavingProfile(true);
        setProfileMsg(null);
        try {
            const payload: { first_name?: string; last_name?: string; email?: string; current_password?: string; contact_number?: string } = {};
            if (profileForm.first_name.trim()) payload.first_name = profileForm.first_name.trim();
            if (profileForm.last_name.trim()) payload.last_name = profileForm.last_name.trim();
            if (profileForm.email.trim()) {
                if (!profileForm.current_password.trim()) {
                    setProfileMsg({ type: 'error', text: 'Current password is required to change your email/login identity.' });
                    setSavingProfile(false);
                    return;
                }
                payload.email = profileForm.email.trim();
                payload.current_password = profileForm.current_password;
            }
            if (profileForm.contact_number.trim()) payload.contact_number = profileForm.contact_number.trim();
            if (Object.keys(payload).length === 0) {
                setProfileMsg({ type: 'error', text: 'No fields to update.' });
                setSavingProfile(false);
                return;
            }
            const result = await updateMyProfile(payload);
            if (result.status === 'partial') {
                setProfileMsg({ type: 'error', text: result.message || 'Profile update partially completed. Contact support if details are missing.' });
                setProfileForm(p => ({ ...p, current_password: '' }));
            } else if (result.status === 'ok') {
                setProfileMsg({ type: 'success', text: result.message || 'Profile updated successfully.' });
                setProfileForm({ first_name: '', last_name: '', email: '', current_password: '', contact_number: '' });
            } else {
                setProfileMsg({ type: 'error', text: result.message || 'Profile update returned an unexpected status.' });
                setProfileForm(p => ({ ...p, current_password: '' }));
            }
            fetchMyProfile().then(data => {
                setCurrentProfile({
                    first_name: data.first_name,
                    last_name: data.last_name,
                    email: data.email,
                    contact_number: data.contact_number
                });
                setNotifPrefs({
                    email_opt_in: data.email_opt_in ?? true,
                    push_opt_in: data.push_opt_in ?? true,
                });
            }).catch(e => console.error("Failed to refresh profile after save", e));
        } catch (e: unknown) {
            setProfileMsg({ type: 'error', text: (e as { message?: string })?.message ?? 'Update failed.' });
        } finally {
            setSavingProfile(false);
        }
    };

    const handleSaveNotifPrefs = async () => {
        setSavingNotif(true);
        setNotifMsg(null);
        try {
            const result = await updateMyProfile({
                email_opt_in: notifPrefs.email_opt_in,
                push_opt_in: notifPrefs.push_opt_in,
            });
            if (result.status === 'ok') {
                setNotifMsg({ type: 'success', text: 'Notification preferences saved.' });
            } else {
                setNotifMsg({ type: 'error', text: result.message || 'Failed to save preferences.' });
            }
        } catch (e: unknown) {
            setNotifMsg({ type: 'error', text: (e as { message?: string })?.message ?? 'Save failed.' });
        } finally {
            setSavingNotif(false);
        }
    };

    const handleChangePassword = async () => {
        setPwdMsg(null);
        if (pwdForm.new_password !== pwdForm.confirm_password) {
            setPwdMsg({ type: 'error', text: 'Passwords do not match.' });
            return;
        }
        if (pwdForm.new_password.length < 12) {
            setPwdMsg({ type: 'error', text: 'Password must be at least 12 characters long.' });
            return;
        }
        setSavingPwd(true);
        try {
            const payload: { current_password: string; new_password: string; otp_code?: string } = {
                current_password: pwdForm.current_password,
                new_password: pwdForm.new_password,
            };
            if (pwdForm.otp_code.trim()) payload.otp_code = pwdForm.otp_code.trim();
            await changeMyPassword(payload);
            setPwdMsg({ type: 'success', text: 'Password changed successfully. Logging you out for security…' });
            setPwdForm({ current_password: '', new_password: '', confirm_password: '', otp_code: '' });
            setTimeout(() => logout(), 1500);
        } catch (e: unknown) {
            setPwdMsg({ type: 'error', text: (e as { message?: string })?.message ?? 'Password change failed.' });
        } finally {
            setSavingPwd(false);
        }
    };

    // ---------------------------------------------------------------------------
    // Role display label
    // ---------------------------------------------------------------------------
    const roleLabel: Record<string, string> = {
        REGIONAL_ENCODER: 'Regional Encoder',
        NATIONAL_VALIDATOR: 'National Validator',
        NATIONAL_ANALYST: 'National Analyst',
        SYSTEM_ADMIN: 'System Administrator',
        CIVILIAN_REPORTER: 'Civilian Reporter',
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh] text-gray-500">
                Loading…
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-2xl mx-auto">
            <div>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>My Profile</h1>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Update your personal information and change your password.
                </p>
            </div>

            {/* Account Summary Card */}
            <section className="card overflow-hidden">
                <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <User className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <span>Account Information</span>
                </div>
                <div className="card-body">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Username / Email</p>
                            <p style={{ color: 'var(--text-primary)' }}>{typedUser?.username ?? '—'}</p>
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Role</p>
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold text-white" style={{ backgroundColor: 'var(--sidebar-bg)' }}>
                                {roleLabel[typedUser?.role ?? ''] ?? typedUser?.role ?? '—'}
                            </span>
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>User ID</p>
                            <p className="text-xs text-gray-400">{typedUser?.id ?? '—'}</p>
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Assigned Region</p>
                            <p style={{ color: 'var(--text-primary)' }}>
                              {typedUser?.role === 'NATIONAL_ANALYST'
                                ? 'All Regions'
                                : typedUser?.role === 'SYSTEM_ADMIN'
                                ? 'National'
                                : (typedUser?.assignedRegionId ?? '—')}
                            </p>
                        </div>
                    </div>
                    <p className="mt-4 text-xs text-gray-400">
                        Role and region assignment can only be changed by a System Administrator.
                    </p>
                </div>
            </section>

            {/* Edit Profile Card */}
            <section className="card overflow-hidden">
                <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <Mail className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <span>Edit Profile</span>
                </div>
                <div className="card-body space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <div className="flex justify-between items-end mb-1">
                                <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                    First Name
                                </label>
                            </div>
                            <input
                                id="profile-first-name"
                                type="text"
                                value={profileForm.first_name}
                                onChange={e => setProfileForm(p => ({ ...p, first_name: e.target.value }))}
                                placeholder={currentProfile?.first_name || "First Name"}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
                            />
                        </div>
                        <div>
                            <div className="flex justify-between items-end mb-1">
                                <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                    Last Name
                                </label>
                            </div>
                            <input
                                id="profile-last-name"
                                type="text"
                                value={profileForm.last_name}
                                onChange={e => setProfileForm(p => ({ ...p, last_name: e.target.value }))}
                                placeholder={currentProfile?.last_name || "Last Name"}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-end mb-1">
                            <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                <Mail className="w-3 h-3 inline mr-1" />
                                Email
                            </label>
                            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                                Current: <span className="font-medium">{currentProfile?.email || typedUser?.email || '—'}</span>
                            </span>
                        </div>
                        <input
                            id="profile-email"
                            type="email"
                            value={profileForm.email}
                            onChange={e => setProfileForm(p => ({ ...p, email: e.target.value }))}
                            placeholder={currentProfile?.email || typedUser?.email || 'you@bfp.gov.ph'}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
                        />
                        <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                            <AlertCircle className="w-3 h-3" />
                            Changing your email updates your login identity/username and requires your current password.
                        </p>
                        {profileForm.email.trim() && (
                            <div className="mt-3">
                                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                                    Current Password for Email Change
                                </label>
                                <input
                                    id="profile-email-current-password"
                                    type="password"
                                    value={profileForm.current_password}
                                    onChange={e => setProfileForm(p => ({ ...p, current_password: e.target.value }))}
                                    placeholder="Enter current password to change email"
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
                                />
                            </div>
                        )}
                    </div>

                    <div>
                        <div className="flex justify-between items-end mb-1">
                            <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                <Phone className="w-3 h-3 inline mr-1" />
                                Contact Number
                            </label>
                            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                                Current: <span className="font-medium">{currentProfile?.contact_number || '—'}</span>
                            </span>
                        </div>
                        <input
                            id="profile-contact"
                            type="tel"
                            value={profileForm.contact_number}
                            onChange={e => setProfileForm(p => ({ ...p, contact_number: e.target.value }))}
                            onBlur={() => setContactTouched(true)}
                            placeholder="e.g. 09171234567"
                            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${contactTouched && profileForm.contact_number.length > 0 && !isPhoneValid(profileForm.contact_number)
                                    ? 'border-red-500 focus:ring-red-500'
                                    : 'focus:ring-blue-500'
                                }`}
                            style={{
                                borderColor: contactTouched && profileForm.contact_number.length > 0 && !isPhoneValid(profileForm.contact_number) ? '#ef4444' : 'var(--border-color)',
                                backgroundColor: 'var(--card-bg)',
                                color: 'var(--text-primary)'
                            }}
                        />
                        {contactTouched && profileForm.contact_number.length > 0 && !isPhoneValid(profileForm.contact_number) && (
                            <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                Invalid format. Must be 11 digits starting with 09 (e.g. 09171234567).
                            </p>
                        )}
                    </div>



                    {profileMsg && (
                        <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${profileMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {profileMsg.type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                            {profileMsg.text}
                        </div>
                    )}

                    <button
                        id="profile-save-btn"
                        onClick={handleSaveProfile}
                        disabled={savingProfile}
                        className="flex items-center gap-2 px-5 py-2 rounded-lg text-white font-semibold text-sm disabled:opacity-50"
                        style={{ backgroundColor: 'var(--sidebar-bg)' }}
                    >
                        {savingProfile ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving…</> : <><Save className="w-4 h-4" /> Save Changes</>}
                    </button>
                </div>
            </section>

            {/* Notification Preferences Card */}
            <section className="card overflow-hidden">
                <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid var(--sidebar-bg)' }}>
                    <Bell className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <span>Notification Preferences</span>
                </div>
                <div className="card-body space-y-4">
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Choose how you receive system notifications (alerts, weekly reports) and push updates.
                    </p>
                    <div className="space-y-3">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only"
                                checked={notifPrefs.email_opt_in}
                                onChange={() => setNotifPrefs(p => ({ ...p, email_opt_in: !p.email_opt_in }))}
                            />
                            <div className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 relative ${notifPrefs.email_opt_in ? 'bg-red-800' : 'bg-gray-300'}`}>
                                <div className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${notifPrefs.email_opt_in ? 'translate-x-4' : 'translate-x-0'}`} />
                            </div>
                            <div>
                                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Email Notifications</p>
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Receive system alerts and weekly reports via email</p>
                            </div>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only"
                                checked={notifPrefs.push_opt_in}
                                onChange={() => setNotifPrefs(p => ({ ...p, push_opt_in: !p.push_opt_in }))}
                            />
                            <div className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 relative ${notifPrefs.push_opt_in ? 'bg-red-800' : 'bg-gray-300'}`}>
                                <div className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${notifPrefs.push_opt_in ? 'translate-x-4' : 'translate-x-0'}`} />
                            </div>
                            <div>
                                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Push Notifications</p>
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Receive push alerts on your registered device</p>
                            </div>
                        </label>
                    </div>

                    {notifMsg && (
                        <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${notifMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {notifMsg.type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                            {notifMsg.text}
                        </div>
                    )}

                    <button
                        id="notif-prefs-save-btn"
                        onClick={handleSaveNotifPrefs}
                        disabled={savingNotif}
                        className="flex items-center gap-2 px-5 py-2 rounded-lg text-white font-semibold text-sm disabled:opacity-50"
                        style={{ backgroundColor: 'var(--sidebar-bg)' }}
                    >
                        {savingNotif ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving…</> : <><Save className="w-4 h-4" /> Save Preferences</>}
                    </button>
                </div>
            </section>

            {/* Change Password Card */}
            <section className="card overflow-hidden">
                <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid #dc2626' }}>
                    <Lock className="w-4 h-4 text-red-600" />
                    <span>Change Password</span>
                </div>
                <div className="card-body space-y-4">
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Your new password must be at least 12 characters long and contain uppercase letters, numbers, and at least one special character.
                    </p>

                    <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Current Password</label>
                        <div className="relative mb-4">
                            <input
                                id="profile-pwd-current"
                                type={showCurrentPwd ? 'text' : 'password'}
                                value={pwdForm.current_password}
                                onChange={e => setPwdForm(p => ({ ...p, current_password: e.target.value }))}
                                placeholder="Enter current password"
                                className="w-full border rounded-lg px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
                            />
                            <button type="button" onClick={() => setShowCurrentPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                {showCurrentPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    {/* OTP field — shown for users with 2FA enrolled */}
                    <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                            Authenticator Code <span className="font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>(only if 2FA is enabled)</span>
                        </label>
                        <input
                            id="profile-otp-code"
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={pwdForm.otp_code}
                            onChange={e => setPwdForm(p => ({ ...p, otp_code: e.target.value.replace(/\D/g, '') }))}
                            placeholder="6-digit code from your authenticator app"
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>New Password</label>
                        <div className="relative">
                            <input
                                id="profile-new-password"
                                type={showNew ? 'text' : 'password'}
                                value={pwdForm.new_password}
                                onChange={e => setPwdForm(p => ({ ...p, new_password: e.target.value }))}
                                placeholder="Enter new password"
                                className="w-full border rounded-lg px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
                            />
                            <button type="button" onClick={() => setShowNew(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                        {/* Strength indicator */}
                        {pwdForm.new_password && (
                            <div className="mt-1.5 flex gap-1">
                                {[1, 2, 3, 4].map(level => {
                                    const specialChars = "!@#$%^&*()-_=+[]{}|;:'\\\",.<>?/`~";
                                    const strength = [
                                        pwdForm.new_password.length >= 12,
                                        /[A-Z]/.test(pwdForm.new_password),
                                        /[0-9]/.test(pwdForm.new_password),
                                        [...pwdForm.new_password].some(c => specialChars.includes(c)),
                                    ].filter(Boolean).length;
                                    return (
                                        <div
                                            key={level}
                                            className="h-1 flex-1 rounded-full transition-all"
                                            style={{ backgroundColor: level <= strength ? (strength <= 2 ? '#f97316' : strength === 3 ? '#facc15' : '#22c55e') : '#e5e7eb' }}
                                        />
                                    );
                                })}
                                <span className="text-xs text-gray-400 ml-1">
                                    {[pwdForm.new_password.length >= 12, /[A-Z]/.test(pwdForm.new_password), /[0-9]/.test(pwdForm.new_password), [...pwdForm.new_password].some(c => "!@#$%^&*()-_=+[]{}|;:'\\\",.<>?/`~".includes(c))].filter(Boolean).length <= 2 ? 'Weak' :
                                        [pwdForm.new_password.length >= 12, /[A-Z]/.test(pwdForm.new_password), /[0-9]/.test(pwdForm.new_password), [...pwdForm.new_password].some(c => "!@#$%^&*()-_=+[]{}|;:'\\\",.<>?/`~".includes(c))].filter(Boolean).length === 3 ? 'Fair' : 'Strong'}
                                </span>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Confirm New Password</label>
                        <div className="relative">
                            <input
                                id="profile-confirm-password"
                                type={showConfirm ? 'text' : 'password'}
                                value={pwdForm.confirm_password}
                                onChange={e => setPwdForm(p => ({ ...p, confirm_password: e.target.value }))}
                                placeholder="Re-enter new password"
                                className="w-full border rounded-lg px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)' }}
                            />
                            <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                        {pwdForm.confirm_password && pwdForm.new_password !== pwdForm.confirm_password && (
                            <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                        )}
                    </div>

                    {pwdMsg && (
                        <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${pwdMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {pwdMsg.type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                            {pwdMsg.text}
                        </div>
                    )}

                    <button
                        id="profile-change-password-btn"
                        onClick={handleChangePassword}
                        disabled={savingPwd || !pwdForm.current_password || !pwdForm.new_password || !pwdForm.confirm_password}
                        className="flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-sm disabled:opacity-50 text-white"
                        style={{ backgroundColor: '#991B1B' }}
                    >
                        {savingPwd ? <><RefreshCw className="w-4 h-4 animate-spin" /> Changing…</> : <><Lock className="w-4 h-4" /> Change Password</>}
                    </button>
                </div>
            </section>
        </div>
    );
}
