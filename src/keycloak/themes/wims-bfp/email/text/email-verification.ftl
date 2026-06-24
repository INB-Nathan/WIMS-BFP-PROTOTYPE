<#ftl output_format="plainText">
<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>
Hello ${displayName},

Please verify your email address to complete your WIMS-BFP account setup. Click the link below to confirm this email is yours.

${link}

This link expires in ${linkExpirationFormatter(linkExpiration)} and can only be used once.

If you did not create a WIMS-BFP account, please ignore this email.

— Bureau of Fire Protection — WIMS-BFP
This is an automated message. Do not reply to this email.
