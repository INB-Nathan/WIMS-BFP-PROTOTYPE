import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoginPage from './page';
import * as supabaseClientModule from '@/lib/supabaseClient';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock the Auth profile
vi.mock('@/lib/auth', () => ({
  useUserProfile: () => ({
    user: null,
  }),
}));

// Mock Next/Image to prevent warnings
vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => {
    return <img {...props} alt={props.alt} />;
  },
}));

// Spy on createClient to detect if Supabase is still used
vi.mock('@/lib/supabaseClient', () => {
  return {
    createClient: vi.fn().mockImplementation(() => {
      return {
        auth: {
          signInWithPassword: vi.fn().mockResolvedValue({ error: null, data: {} }),
        }
      };
    }),
  };
});

describe('Tier 3 Compliance: Auth Guard Consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Adversarial Test 1: Should physically lack or fail on Supabase imports', async () => {
    render(<LoginPage />);

    const emailInput = screen.queryByPlaceholderText(/Username \/ Email/i);
    const passwordInput = screen.queryByPlaceholderText(/Password/i);
    const submitButton = screen.queryByRole('button', { name: /Login with Keycloak/i }) || screen.getByRole('button', { name: /Login/i });

    if (emailInput && passwordInput) {
        fireEvent.change(emailInput, { target: { value: 'test@bfp.gov.ph' } });
        fireEvent.change(passwordInput, { target: { value: 'password123' } });
    }
    
    fireEvent.click(submitButton);

    await waitFor(() => {
      // The application should NOT invoke createClient anywhere.
      // If it does, we violate the "Strip all Supabase imports" rule and hit RED state.
      expect(supabaseClientModule.createClient).not.toHaveBeenCalled();
    });
  });

  it('Adversarial Test 2: Should attempt login via OIDC/PKCE to Keycloak endpoint', async () => {
    const assignSpy = vi.fn();
    const originalLocation = window.location;
    delete (window as any).location;
    window.location = { ...originalLocation, assign: assignSpy, href: '' } as any;

    render(<LoginPage />);

    const emailInput = screen.queryByPlaceholderText(/Username \/ Email/i);
    const passwordInput = screen.queryByPlaceholderText(/Password/i);
    const submitButton = screen.queryByRole('button', { name: /Login with Keycloak/i }) || screen.getByRole('button', { name: /Login/i });

    if (emailInput && passwordInput) {
        fireEvent.change(emailInput, { target: { value: 'test@bfp.gov.ph' } });
        fireEvent.change(passwordInput, { target: { value: 'password123' } });
    }
    
    fireEvent.click(submitButton);

    await waitFor(() => {
        const calls = assignSpy.mock.calls;
        const hrefSet = window.location.href.toLowerCase();
        
        const keycloakCalls = calls.filter(call => {
            const url = call[0].toString().toLowerCase();
            return url.includes('keycloak') || url.includes('openid-connect');
        });
        
        const redirected = keycloakCalls.length > 0 || hrefSet.includes('keycloak') || hrefSet.includes('openid-connect');
        expect(redirected, 'Required Keycloak/OIDC PKCE redirect was not dispatched.').toBe(true);
    });

    window.location = originalLocation;
  });

  it('Adversarial Test 3: Should not have a password form, must use Keycloak redirect button', () => {
    render(<LoginPage />);
    
    // Test should fail if it finds standard password inputs
    const passwordInputs = screen.queryAllByPlaceholderText(/password/i);
    const passwordTypeInputs = document.body.querySelectorAll('input[type="password"]');
    expect(passwordInputs.length, 'Found password placeholder').toBe(0);
    expect(passwordTypeInputs.length, 'Found password input type').toBe(0);
    
    // Assert the new Keycloak login button is present
    const keycloakButton = screen.getByRole('button', { name: /Login with Keycloak/i });
    expect(keycloakButton).toBeDefined();
  });

  it('Adversarial Test 4: Redirect URL contains PKCE code_challenge and method', async () => {
    const originalLocation = window.location;
    // Mock window.location to intercept redirects
    delete (window as any).location;
    window.location = { ...originalLocation, assign: vi.fn(), href: '' } as any;

    render(<LoginPage />);
    
    // Fallback to "Login" if the new button isn't implemented yet, so we can trigger the action
    const button = screen.queryByRole('button', { name: /Login with Keycloak/i }) 
                   || screen.getByRole('button', { name: /Login/i });

    // Provide generic inputs if form is still there to satisfy native validation
    const emailInput = screen.queryByPlaceholderText(/Username \/ Email/i);
    const passwordInput = screen.queryByPlaceholderText(/Password/i);
    if (emailInput && passwordInput) {
      fireEvent.change(emailInput, { target: { value: 'test@bfp.gov.ph' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
    }

    fireEvent.click(button);

    await waitFor(() => {
        const assignCalls = (window.location.assign as any).mock.calls;
        const hrefSet = window.location.href;
        
        // Either window.location.assign was called or window.location.href was mutated
        const redirected = assignCalls.length > 0 || hrefSet !== '';
        expect(redirected, 'Expected window.location to be updated for Keycloak redirect').toBe(true);
        
        const url = assignCalls.length > 0 ? assignCalls[0][0] : hrefSet;
        expect(url, 'Redirect URL must contain code_challenge').toContain('code_challenge=');
        expect(url, 'Redirect URL must contain code_challenge_method=S256').toContain('code_challenge_method=S256');
    }, { timeout: 2000 });

    window.location = originalLocation; // Restore
  });

  it('Adversarial Test 5: Stores code_verifier in sessionStorage', async () => {
    sessionStorage.clear();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    render(<LoginPage />);
    
    const button = screen.queryByRole('button', { name: /Login with Keycloak/i }) 
                   || screen.getByRole('button', { name: /Login/i });

    const emailInput = screen.queryByPlaceholderText(/Username \/ Email/i);
    const passwordInput = screen.queryByPlaceholderText(/Password/i);
    if (emailInput && passwordInput) {
      fireEvent.change(emailInput, { target: { value: 'test@bfp.gov.ph' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
    }

    fireEvent.click(button);

    await waitFor(() => {
        const calls = setItemSpy.mock.calls;
        // Check if any sessionStorage call key implies it's our verifier
        const verifierCall = calls.find(call => typeof call[0] === 'string' && call[0].toLowerCase().includes('verifier'));
        
        const verifier = verifierCall 
            ? verifierCall[1] 
            : (sessionStorage.getItem('code_verifier') || sessionStorage.getItem('pkce_verifier') || sessionStorage.getItem('pkce_code_verifier'));
            
        expect(verifier, 'code_verifier should be securely stored in sessionStorage').toBeTruthy();
        expect(typeof verifier).toBe('string');
        // PKCE verifiers must be at least 43 characters long per RFC 7636
        expect((verifier as string).length, 'Verifier length must be at least 43 chars').toBeGreaterThanOrEqual(43);
    }, { timeout: 2000 });
    
    setItemSpy.mockRestore();
  });
});
