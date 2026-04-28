'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { ArrowRight, Lock, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
    const router = useRouter();
    const { user, loading, login } = useAuth();

    useEffect(() => {
        if (!loading && user) {
            const role = (user as { role?: string })?.role;
            if (role === 'REGIONAL_ENCODER') {
                router.push('/dashboard/regional');
            } else if (role === 'NATIONAL_VALIDATOR' || role === 'VALIDATOR') {
                router.push('/dashboard/validator');
            } else {
                router.push('/dashboard');
            }
        }
    }, [user, loading, router]);

    if (user) {
        return null;
    }

    const handleLogin = () => {
        login();
    };

    return (
        <div className="login-page">
            {/* Left Panel — BFP Branding */}
            <div className="login-left">
                <div className="login-left-content">
                    <div className="login-logo">
                        <Image
                            src="/bfp-logo.svg"
                            alt="Bureau of Fire Protection"
                            fill
                            className="object-contain"
                            priority
                        />
                    </div>

                    <h1 className="login-title">
                        Web-based Incident
                        <br />
                        Management System
                    </h1>
                    <p className="login-subtitle">Bureau of Fire Protection</p>

                    <div className="login-tagline">
                        <ShieldCheck className="w-4 h-4" />
                        <span>Secured &bull; Monitored &bull; Explainable</span>
                    </div>
                </div>
            </div>

            {/* Right Panel — Login Form */}
            <div className="login-right">
                <div className="login-form-container">
                    <h2 className="login-form-title">Sign In</h2>
                    <p className="login-form-subtitle">
                        Access the WIMS-BFP dashboard
                    </p>

                    <div className="login-form-card">
                        <div className="login-sso-notice">
                            <Lock className="w-4 h-4 text-theme-accent-mid flex-shrink-0" />
                            <p>
                                Secure single sign-on powered by Keycloak.
                                Your credentials are never stored by this application.
                            </p>
                        </div>

                        <button
                            onClick={handleLogin}
                            className="login-button"
                        >
                            Login with Keycloak
                            <ArrowRight className="w-4 h-4 login-button-arrow" />
                        </button>
                    </div>

                    <p className="login-copyright">
                        &copy; 2026 Bureau of Fire Protection &mdash; All rights reserved.
                    </p>
                </div>
            </div>
        </div>
    );
}
