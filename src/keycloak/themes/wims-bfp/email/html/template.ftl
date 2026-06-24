<#macro emailLayout>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WIMS-BFP Notification</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:24px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background-color:#8B0000;padding:24px 32px;text-align:center;">
              <img src="${url.resourcesUrl}/img/bfp-logo.png" alt="BFP" width="48" height="48" style="display:block;margin:0 auto 12px;">
              <p style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">Bureau of Fire Protection</p>
              <p style="margin:4px 0 0;color:#ffcccc;font-size:14px;">WIMS-BFP Incident Management System</p>
            </td>
          </tr>
          <!-- Body (per-template content goes here) -->
          <tr>
            <td style="background-color:#ffffff;padding:40px 32px;">
              <#nested>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9f9f9;padding:24px 32px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#999999;line-height:1.6;">
                Bureau of Fire Protection — WIMS-BFP<br/>
                This is an automated message. Do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
</#macro>
