<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('otp','totp'); section>
    <#if section = "header">
        ${msg("doLogIn")}
    <#elseif section = "form">
        <form id="kc-otp-login-form" action="${url.loginAction}" method="post">
            <#if otpLogin.userOtpCredentials?size gt 1>
                <div class="${properties.kcFormGroupClass!}">
                    <label class="pf-v5-c-form__label" for="userCredentialId">
                        <span class="pf-v5-c-form__label-text">${msg("loginOtpOneTime")}</span>
                    </label>
                    <select id="userCredentialId" name="selectedCredentialId" class="pf-v5-c-form-control">
                        <#list otpLogin.userOtpCredentials as otpCredential>
                            <option value="${otpCredential.id}" <#if otpCredential.id == otpLogin.selectedCredentialId>selected="selected"</#if>>
                                ${otpCredential.userLabel}
                            </option>
                        </#list>
                    </select>
                </div>
            </#if>

            <div class="${properties.kcFormGroupClass!}">
                <label class="pf-v5-c-form__label" for="otp-1">
                    <span class="pf-v5-c-form__label-text">${msg("loginOtpOneTime")}</span>
                </label>
                <input id="otp" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" class="wims-otp-hidden" />
                <div class="wims-otp-grid" role="group" aria-label="${msg("loginOtpOneTime")}">
                    <input id="otp-1" class="wims-otp-box" type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code" autofocus />
                    <input class="wims-otp-box" type="text" inputmode="numeric" maxlength="1" />
                    <input class="wims-otp-box" type="text" inputmode="numeric" maxlength="1" />
                    <span class="wims-otp-separator" aria-hidden="true"></span>
                    <input class="wims-otp-box" type="text" inputmode="numeric" maxlength="1" />
                    <input class="wims-otp-box" type="text" inputmode="numeric" maxlength="1" />
                    <input class="wims-otp-box" type="text" inputmode="numeric" maxlength="1" />
                </div>
                <#if messagesPerField.existsError('otp') || messagesPerField.existsError('totp')>
                    <span id="input-error-otp-code" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                        <#if messagesPerField.existsError('otp')>${kcSanitize(messagesPerField.get('otp'))?no_esc}<#else>${kcSanitize(messagesPerField.get('totp'))?no_esc}</#if>
                    </span>
                </#if>
            </div>

            <div class="pf-v5-c-form__group pf-m-action">
                <div class="pf-v5-c-form__actions">
                    <input class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}" name="login" id="kc-login" type="submit" value="${msg("doLogIn")}"/>
                </div>
            </div>
        </form>
        <script>
            (function () {
                var form = document.getElementById('kc-otp-login-form');
                var hidden = document.getElementById('otp');
                var submit = document.getElementById('kc-login');
                var boxes = Array.prototype.slice.call(document.querySelectorAll('.wims-otp-box'));
                function syncHidden() {
                    hidden.value = boxes.map(function (box) { return box.value; }).join('');
                    if (submit) submit.disabled = hidden.value.length !== boxes.length;
                }
                syncHidden();
                boxes.forEach(function (box, index) {
                    box.addEventListener('input', function () {
                        var digits = box.value.replace(/\D/g, '').slice(0, boxes.length - index);
                        digits.split('').forEach(function (digit, offset) {
                            boxes[index + offset].value = digit;
                        });
                        syncHidden();
                        var nextIndex = Math.min(index + digits.length, boxes.length - 1);
                        if (digits.length && index < boxes.length - 1) boxes[nextIndex].focus();
                    });
                    box.addEventListener('keydown', function (event) {
                        if (event.key === 'Backspace' && box.value === '' && index > 0) {
                            boxes[index - 1].focus();
                            boxes[index - 1].value = '';
                            syncHidden();
                            event.preventDefault();
                        }
                    });
                    box.addEventListener('paste', function (event) {
                        event.preventDefault();
                        var text = (event.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, boxes.length);
                        boxes.forEach(function (target, offset) { target.value = text[offset] || ''; });
                        syncHidden();
                        boxes[Math.max(0, Math.min(text.length, boxes.length) - 1)].focus();
                    });
                });
                form.addEventListener('submit', syncHidden);
            })();
        </script>
    </#if>
</@layout.registrationLayout>
