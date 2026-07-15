package gov.bfp.wims.keycloak;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.authenticators.browser.AbstractUsernameFormAuthenticator;
import org.keycloak.authentication.authenticators.browser.OTPFormAuthenticator;
import org.keycloak.events.Errors;
import org.keycloak.forms.login.freemarker.model.TotpLoginBean;
import org.keycloak.models.UserModel;

public class WimsDemoOtpFormAuthenticator extends OTPFormAuthenticator {
    public static final String DEMO_OTP_CODE = "123123";
    private static final Logger LOG = Logger.getLogger(WimsDemoOtpFormAuthenticator.class);

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        UserModel user = context.getUser();
        if (user == null) {
            // Should not reach here (password auth already validated user),
            // but handle defensively — USER_CONFIRMATION_FAILED was removed in KC 26.
            context.attempted();
            return;
        }
        // Always show the OTP form, regardless of whether the user has
        // OTP credentials configured. Role-based conditions in the
        // authentication flow gate when this authenticator runs.
        // Required because Keycloak 26's OTPFormAuthenticator.authenticate()
        // silently calls context.success() when the user has no OTP
        // credential, which bypasses MFA for role-triggered OTP.
        // Must manually set the otpLogin form attribute since we bypass
        // createLoginTotp() (which normally populates it via TotpLoginBean).
        context.form().setAttribute("otpLogin",
            new TotpLoginBean(context.getSession(), context.getRealm(), user, null));
        Response challenge = context.form().createForm("login-otp.ftl");
        context.challenge(challenge);
    }

    @Override
    public void validateOTP(AuthenticationFlowContext context) {
        MultivaluedMap<String, String> inputData =
                context.getHttpRequest().getDecodedFormParameters();
        String otp = inputData.getFirst("otp");
        if (!DEMO_OTP_CODE.equals(otp)) {
            super.validateOTP(context);
            return;
        }
        UserModel userModel = context.getUser();
        if ("true".equals(
                context.getAuthenticationSession()
                        .getAuthNote(AbstractUsernameFormAuthenticator.SESSION_INVALID))) {
            context.getEvent().user(userModel).error(Errors.INVALID_AUTHENTICATION_SESSION);
            super.validateOTP(context);
            return;
        }
        if (!enabledUser(context, userModel)) {
            context.getAuthenticationSession()
                    .setAuthNote(AbstractUsernameFormAuthenticator.SESSION_INVALID, "true");
            return;
        }
        context.getEvent()
                .user(userModel)
                .detail("wims_demo_otp_bypass", "true")
                .detail("wims_demo_otp_provider", WimsDemoOtpFormAuthenticatorFactory.PROVIDER_ID);
        LOG.warnf(
                "Temporary WIMS demo OTP bypass accepted for user %s in realm %s",
                userModel == null ? "<unknown>" : userModel.getUsername(),
                context.getRealm() == null ? "<unknown>" : context.getRealm().getName());
        context.success();
    }
}
