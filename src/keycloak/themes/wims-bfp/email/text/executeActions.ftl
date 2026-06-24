<#ftl output_format="plainText">
<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>
Hello ${displayName},

You have one or more required actions on your WIMS-BFP account. Click the link below to review and complete them.

<#if requiredActions?? && requiredActions?size gt 0>Required actions:
<#list requiredActions as reqAction>- ${msg("requiredAction.${reqAction}")}
</#list>
</#if>

${link}

This link expires in ${linkExpirationFormatter(linkExpiration)} and can only be used once.

If you did not request this, please contact your system administrator.

— Bureau of Fire Protection — WIMS-BFP
This is an automated message. Do not reply to this email.
