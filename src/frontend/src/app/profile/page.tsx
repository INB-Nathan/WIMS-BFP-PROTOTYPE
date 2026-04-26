'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { updateMyProfile, changeMyPassword, fetchMyProfile } from '@/lib/api';
import {
    User,
    Mail,
    Phone,
    Lock,
    CheckCircle,
    AlertCircle,
    Eye,
    EyeOff,
    Save,
    RefreshCw,
} from 'lucide-react';

export default function ProfilePage() {
    const { user, loading } = useAuth();
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
    const [profileForm, setProfileForm] = useState({ first_name: '', last_name: '', contact_number: '' });
    const [currentProfile, setCurrentProfile] = useState<{ first_name: string; last_name: string; contact_number: string } | null>(null);
    const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [savingProfile, setSavingProfile] = useState(false);
    const [contactTouched, setContactTouched] = useState(false);

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
                    contact_number: data.contact_number
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
            const payload: { first_name?: string; last_name?: string; contact_number?: string } = {};
            if (profileForm.first_name.trim()) payload.first_name = profileForm.first_name.trim();
            if (profileForm.last_name.trim()) payload.last_name = profileForm.last_name.trim();
            if (profileForm.contact_number.trim()) payload.contact_number = profileForm.contact_number.trim();
            if (Object.keys(payload).length === 0) {
                setProfileMsg({ type: 'error', text: 'No fields to update.' });
                setSavingProfile(false);
                return;
            }
            await updateMyProfile(payload);
            setProfileMsg({ type: 'success', text: 'Profile updated successfully.' });
            setProfileForm({ first_name: '', last_name: '', contact_number: '' });
            fetchMyProfile().then(data => setCurrentProfile({
                first_name: data.first_name,
                last_name: data.last_name,
                contact_number: data.contact_number
            }));
        } catch (e: unknown) {
            setProfileMsg({ type: 'error', text: (e as { message?: string })?.message ?? 'Update failed.' });
        } finally {
            setSavingProfile(false);
        }
    };

    const handleChangePassword = async () => {
        setPwdMsg(null);
        if (pwdForm.new_password !== pwdForm.confirm_password) {
            setPwdMsg({ type: 'error', text: 'Passwords do not match.' });
            return;
        }
        if (pwdForm.new_password.length < 8) {
            setPwdMsg({ type: 'error', text: 'Password must be at least 8 characters long.' });
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
            setPwdMsg({ type: 'success', text: 'Password changed successfully. Use your new password on next login.' });
            setPwdForm({ current_password: '', new_password: '', confirm_password: '', otp_code: '' });
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
                              {typedUser?.role === 'NATIONAL_ANALYST' || typedUser?.role === 'SYSTEM_ADMIN'
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

            {/* Change Password Card */}
            <section className="card overflow-hidden">
                <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid #dc2626' }}>
                    <Lock className="w-4 h-4 text-red-600" />
                    <span>Change Password</span>
                </div>
                <div className="card-body space-y-4">
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Your new password must be at least 8 characters long and contain uppercase letters, numbers, and at least one special character.
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
                                        pwdForm.new_password.length >= 8,
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
                                    {[pwdForm.new_password.length >= 8, /[A-Z]/.test(pwdForm.new_password), /[0-9]/.test(pwdForm.new_password), [...pwdForm.new_password].some(c => "!@#$%^&*()-_=+[]{}|;:'\\\",.<>?/`~".includes(c))].filter(Boolean).length <= 2 ? 'Weak' :
                                        [pwdForm.new_password.length >= 8, /[A-Z]/.test(pwdForm.new_password), /[0-9]/.test(pwdForm.new_password), [...pwdForm.new_password].some(c => "!@#$%^&*()-_=+[]{}|;:'\\\",.<>?/`~".includes(c))].filter(Boolean).length === 3 ? 'Fair' : 'Strong'}
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
                        style={{ backgroundColor: '#dc2626' }}
                    >
                        {savingPwd ? <><RefreshCw className="w-4 h-4 animate-spin" /> Changing…</> : <><Lock className="w-4 h-4" /> Change Password</>}
                    </button>
                </div>
            </section>
        </div>
    );
}
