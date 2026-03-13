import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

describe('Design System Integrity & Token Audit (The Red State)', () => {
    it('should not contain raw calc values without standardized spacing in globals.css', () => {
        const globalsPath = path.join(__dirname, '../globals.css');
        const globalsContent = fs.readFileSync(globalsPath, 'utf-8');

        // Check if there are raw rem/px values inside calc() instead of var(--spacing-*)
        const rawCalcPattern = /calc\([^;]*\b\d+(rem|px)\b[^;]*\)/;
        const hasRawCalc = rawCalcPattern.test(globalsContent);

        expect(hasRawCalc, 
            'Found raw spacing units (rem/px) inside calc() in globals.css. ' +
            'Use standardized spacing variables like var(--spacing-32) instead.'
        ).toBe(false);
    });

    it('should not contain hardcoded hex codes in utility classes in globals.css', () => {
        const globalsPath = path.join(__dirname, '../globals.css');
        const globalsContent = fs.readFileSync(globalsPath, 'utf-8');

        // Check for hardcoded hex codes outside the @theme directive
        // Utilities like bg-theme-gradient-fire should use var(--color-*)
        const utilityBlockPattern = /@utility\b[^\{]*\{([^}]*)\}/g;
        let match;
        const hexViolations: string[] = [];

        while ((match = utilityBlockPattern.exec(globalsContent)) !== null) {
            const utilityContent = match[1];
            const hexPattern = /#[0-9a-fA-F]{3,6}/g;
            const hexMatches = utilityContent.match(hexPattern);
            if (hexMatches) {
                hexViolations.push(...hexMatches);
            }
        }

        expect(hexViolations.length, 
            `Found hardcoded hex codes in utilities: ${hexViolations.join(', ')}. ` +
            'Please use semantic token variables (var(--color-*)).'
        ).toBe(0);
    });

    it('should avoid hardcoded Tailwind color variables in adjacent layout/shell files', () => {
        const layoutShellPath = path.join(__dirname, '../../components/LayoutShell.tsx');
        
        // Ensure the file exists before testing
        if (!fs.existsSync(layoutShellPath)) {
            return;
        }

        const shellContent = fs.readFileSync(layoutShellPath, 'utf-8');
        
        // Look for common hardcoded tailwind flavors that were missed
        // bg-gray-50, text-gray-500, etc.
        const colorRegex = /\b(bg|text|text|border|from|via|to|ring|shadow|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d{2,3})?\b/g;
        
        const violations = shellContent.match(colorRegex) || [];
        const uniqueViolations = Array.from(new Set(violations));

        expect(uniqueViolations.length, 
            `Shadow Vibes Detected! Found missed hardcoded styles in adjacent layout file (LayoutShell.tsx): ${uniqueViolations.join(', ')}`
        ).toBe(0);
    });
});
