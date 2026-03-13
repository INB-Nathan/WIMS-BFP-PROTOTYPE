import '@testing-library/jest-dom'

// Required for OIDC module guard; tests need NEXT_PUBLIC_AUTH_API_URL
process.env.NEXT_PUBLIC_AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || 'http://localhost/auth'
