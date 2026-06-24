<#ftl output_format="plainText">
<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>
Hello ${displayName},

We received a request to reset your WIMS-BFP account password. Click the link below to set a new password.

${link}

This link expires in ${linkExpirationFormatter(linkExpiration)} and can only be used once.

If you did not request a password reset, please ignore this email or contact your system administrator.

— Bureau of Fire Protection — WIMS-BFP
This is an automated message. Do not reply to this email.
