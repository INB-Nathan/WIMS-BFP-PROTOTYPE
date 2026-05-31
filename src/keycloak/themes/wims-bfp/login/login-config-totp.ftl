<#import "template.ftl" as layout>
<#import "password-commons.ftl" as passwordCommons>
<@layout.registrationLayout displayRequiredFields=false displayMessage=false; section>

    <#if section = "header">
        ${msg("loginTotpTitle")}
    <#elseif section = "form">
        <div class="wims-totp-setup">
            <div class="wims-totp-grid-layout">
                <section class="wims-totp-guidance" aria-labelledby="wims-totp-guidance-title">
                    <h2 id="wims-totp-guidance-title">Setup Instructions</h2>
                    <ol id="kc-totp-settings" class="wims-totp-steps">
                        <li>
                            <span class="wims-totp-step-number">1</span>
                            <div>
                                <p>${msg("loginTotpStep1")}</p>
                                <ul id="kc-totp-supported-apps">
                                    <#list totp.supportedApplications as app>
                                        <li>${msg(app)}</li>
                                    </#list>
                                </ul>
                            </div>
                        </li>
                        <li>
                            <span class="wims-totp-step-number">2</span>
                            <div>
                                <#if mode?? && mode = "manual">
                                    <p>${msg("loginTotpManualStep2")}</p>
                                <#else>
                                    <p>${msg("loginTotpStep2")}</p>
                                </#if>
                            </div>
                        </li>
                        <li>
                            <span class="wims-totp-step-number">3</span>
                            <div>
                                <p>${msg("loginTotpStep3")}</p>
                                <p>${msg("loginTotpStep3DeviceName")}</p>
                            </div>
                        </li>
                    </ol>
                </section>

                <section class="wims-totp-entry" aria-label="${msg("loginTotpTitle")}">
                    <div class="wims-totp-qr-card">
                        <#if mode?? && mode = "manual">
                            <p class="wims-totp-card-label">${msg("loginTotpManualStep2")}</p>
                            <p><span id="kc-totp-secret-key">${totp.totpSecretEncoded}</span></p>
                            <ul class="wims-totp-policy-list">
                                <li id="kc-totp-type">${msg("loginTotpType")}: ${msg("loginTotp." + totp.policy.type)}</li>
                                <li id="kc-totp-algorithm">${msg("loginTotpAlgorithm")}: ${totp.policy.getAlgorithmKey()}</li>
                                <li id="kc-totp-digits">${msg("loginTotpDigits")}: ${totp.policy.digits}</li>
                                <#if totp.policy.type = "totp">
                                    <li id="kc-totp-period">${msg("loginTotpInterval")}: ${totp.policy.period}</li>
                                <#elseif totp.policy.type = "hotp">
                                    <li id="kc-totp-counter">${msg("loginTotpCounter")}: ${totp.policy.initialCounter}</li>
                                </#if>
                            </ul>
                            <p><a href="${totp.qrUrl}" id="mode-barcode">${msg("loginTotpScanBarcode")}</a></p>
                        <#else>
                            <p class="wims-totp-card-label">${msg("loginTotpStep2")}</p>
                            <img id="kc-totp-secret-qr-code" src="data:image/png;base64, ${totp.totpSecretQrCode}" alt="Figure: Barcode">
                            <p><a href="${totp.manualUrl}" id="mode-manual">${msg("loginTotpUnableToScan")}</a></p>
                        </#if>
                    </div>

                    <#if message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
                        <div class="${properties.kcAlertClass!} pf-m-${(message.type = 'error')?then('danger', message.type)}">
                            <div class="pf-v5-c-alert__icon">
                                <#if message.type = 'success'><span class="${properties.kcFeedbackSuccessIcon!}"></span></#if>
                                <#if message.type = 'warning'><span class="${properties.kcFeedbackWarningIcon!}"></span></#if>
                                <#if message.type = 'error'><span class="${properties.kcFeedbackErrorIcon!}"></span></#if>
                                <#if message.type = 'info'><span class="${properties.kcFeedbackInfoIcon!}"></span></#if>
                            </div>
                            <span class="${properties.kcAlertTitleClass!}">${kcSanitize(message.summary)?no_esc}</span>
                        </div>
                    </#if>

                    <form action="${url.loginAction}" class="${properties.kcFormClass!}" id="kc-totp-settings-form" method="post">
            <div class="${properties.kcFormGroupClass!}">
                <div class="${properties.kcLabelClass!}">
                    <label class="pf-v5-c-form__label" for="form-vertical-name">
                        <span class="pf-v5-c-form__label-text">${msg("authenticatorCode")}</span>&nbsp;<span class="pf-v5-c-form__label-required" aria-hidden="true">&#42;</span>
                    </label>
                </div>
                <div class="<#if messagesPerField.existsError('totp')>pf-m-error</#if>">
                    <input type="text" id="totp" name="totp" autocomplete="one-time-code"
                           inputmode="numeric"
                           class="wims-otp-hidden"
                           aria-invalid="<#if messagesPerField.existsError('totp')>true</#if>"
                    />
                    <div class="wims-otp-grid" role="group" aria-label="${msg("authenticatorCode")}">
                        <input id="totp-1" class="wims-otp-box" type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code" />
                        <input class="wims-otp-box" type="text" inputmode="numeric" maxlength="1" />
                        <input class="wims-otp-box" type="text" inputmode="numeric" maxlength="1" />
                        <span class="wims-otp-separator" aria-hidden="true"></span>
                        <input class="wims-otp-box" type="text" inputmode="numeric" maxlength="1" />
                        <input class="wims-otp-box" type="text" inputmode="numeric" maxlength="1" />
                        <input class="wims-otp-box" type="text" inputmode="numeric" maxlength="1" />
                    </div>

                    <#if messagesPerField.existsError('totp')>
                        <span class="pf-v5-c-form-control__utilities">
                            <span class="pf-v5-c-form-control__icon pf-m-status">
                                <i class="fas fa-exclamation-circle" aria-hidden="true"></i>
                            </span>
                        </span>
                    </#if>
                </div>
                <#if messagesPerField.existsError('totp')>
                    <span id="input-error-otp-code" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                        ${kcSanitize(messagesPerField.get('totp'))?no_esc}
                    </span>
                </#if>
                <input type="hidden" id="totpSecret" name="totpSecret" value="${totp.totpSecret}" />
                <#if mode??><input type="hidden" id="mode" name="mode" value="${mode}"/></#if>
            </div>
            <div class="${properties.kcFormGroupClass!}">
                <div class="${properties.kcLabelClass!}">
                    <label class="pf-v5-c-form__label" for="form-vertical-name">
                        <span class="pf-v5-c-form__label-text">${msg("loginTotpDeviceName")}</span><#if totp.otpCredentials?size gte 1>&nbsp;<span class="pf-v5-c-form__label-required" aria-hidden="true">&#42;</span></#if>
                    </label>
                </div>

                <div class="${properties.kcInputClass!}">
                    <input type="text" id="userLabel" name="userLabel" autocomplete="off"
                           aria-invalid="<#if messagesPerField.existsError('userLabel')>true</#if>"
                    />

                    <#if messagesPerField.existsError('userLabel')>
                        <span class="pf-v5-c-form-control__utilities">
                            <span class="pf-v5-c-form-control__icon pf-m-status">
                                <i class="fas fa-exclamation-circle" aria-hidden="true"></i>
                            </span>
                        </span>
                    </#if>
                </div>
                <#if messagesPerField.existsError('userLabel')>
                    <span id="input-error-otp-label" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                        ${kcSanitize(messagesPerField.get('userLabel'))?no_esc}
                    </span>
                </#if>
            </div>

            <div class="${properties.kcFormGroupClass!}">
                <@passwordCommons.logoutOtherSessions/>
            </div>

            <div class="pf-v5-c-form__group pf-m-action">
                <div class="pf-v5-c-form__actions">
                    <#if isAppInitiatedAction??>
                        <input type="submit"
                            class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonLargeClass!}"
                            id="saveTOTPBtn" value="${msg("doSubmit")}"
                        />
                        <button type="submit"
                                class="${properties.kcButtonClass!} ${properties.kcButtonDefaultClass!} ${properties.kcButtonLargeClass!} ${properties.kcButtonLargeClass!}"
                                id="cancelTOTPBtn" name="cancel-aia" value="true" />${msg("doCancel")}
                        </button>
                    <#else>
                        <input type="submit"
                            class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
                            id="saveTOTPBtn" value="${msg("doSubmit")}"
                        />
                    </#if>
                </div>
            </div>
            <script>
                (function () {
                    var form = document.getElementById('kc-totp-settings-form');
                    var hidden = document.getElementById('totp');
                    var submit = document.getElementById('saveTOTPBtn');
                    var boxes = Array.prototype.slice.call(form.querySelectorAll('.wims-otp-box'));
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
                    </form>
                </section>
            </div>
        </div>
    </#if>
</@layout.registrationLayout>
