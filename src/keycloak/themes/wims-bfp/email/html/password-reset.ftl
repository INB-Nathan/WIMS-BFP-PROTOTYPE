<#import "template.ftl" as layout>
<#-- displayName: null-safe + empty-string-safe fallback. The <#assign> + ?then pattern
     handles BOTH the null/missing case AND the empty-string case (FreeMarker's !
     operator only handles null/missing, not empty strings). The result is then
     HTML-escaped with ?html to prevent XSS in the rendered email. -->
<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>
<@layout.emailLayout>
  <p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#8B0000;">Hello, ${displayName?html}!</p>
  <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.6;">
    We received a request to reset your WIMS-BFP account password. Click the button below to set a new password.
  </p>
  <p style="margin:0 0 24px;font-size:16px;color:#333333;line-height:1.6;">
    This link expires in <strong>${linkExpirationFormatter(linkExpiration)}</strong> and can only be used once.
  </p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr>
      <td style="background-color:#8B0000;border-radius:4px;padding:12px 32px;text-align:center;">
        <a href="${link?html}" style="color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;display:inline-block;">Reset Password</a>
      </td>
    </tr>
  </table>
  <p style="margin:0;font-size:14px;color:#666666;line-height:1.6;">
    If you did not request a password reset, please ignore this email or contact your system administrator.
  </p>
</@layout.emailLayout>
