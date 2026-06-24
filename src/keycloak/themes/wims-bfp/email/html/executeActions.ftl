<#import "template.ftl" as layout>
<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>
<@layout.emailLayout>
  <p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#8B0000;">Hello, ${displayName}!</p>
  <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.6;">
    You have one or more required actions on your WIMS-BFP account. Click the button below to review and complete them.
  </p>
  <#if requiredActions?? && requiredActions?size gt 0>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      <#list requiredActions as reqAction>
        <tr><td style="font-size:16px;color:#333333;line-height:1.6;padding:2px 0;">&bull; ${msg("requiredAction.${reqAction}")}</td></tr>
      </#list>
    </table>
  </#if>
  <p style="margin:0 0 24px;font-size:16px;color:#333333;line-height:1.6;">
    This link expires in <strong>${linkExpirationFormatter(linkExpiration)}</strong> and can only be used once.
  </p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr>
      <td style="background-color:#8B0000;border-radius:4px;padding:12px 32px;text-align:center;">
        <a href="${link}" style="color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;display:inline-block;">Review Required Actions</a>
      </td>
    </tr>
  </table>
  <p style="margin:0;font-size:14px;color:#666666;line-height:1.6;">
    If you did not request this, please contact your system administrator.
  </p>
</@layout.emailLayout>
