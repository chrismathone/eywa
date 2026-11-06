/* eslint-disable -- makeedu 원본 사본(시험 픽스처) · 고치지 않는다 */
// 시험 픽스처 — makeedu /js/login-bot-check.js 사본(2026-11-06 GET으로 받은 것 · Last-Modified 2026-11-04 08:38 GMT). 고치지 말 것:
// 이 스크립트가 제출 때 loginBrowserRuntime을 스스로 채우는지(우리가 값을 건드리지 않는지)를 시험이 확인한다.
(function (window, $) {
    'use strict';
    var required = false, submitting = false, loading = false, widget = null;

    function message(text) { $('#error').text(text); }
    function reset() {
        if (widget !== null && window.grecaptcha) window.grecaptcha.reset(widget);
    }
    window.loginCaptchaReady = function () {
        if (!required || widget !== null) return;
        widget = window.grecaptcha.render('login-human-widget', {
            sitekey: $('#login-human-widget').attr('data-sitekey'),
            'expired-callback': function () { message('사람 확인 시간이 만료되었습니다. 다시 확인해 주세요.'); },
            'error-callback': function () { message('사람 확인을 연결할 수 없습니다. 새로고침 후 다시 시도해 주세요.'); }
        });
    };
    function show() {
        required = true;
        $('#login-human-check').show();
        message('안전한 로그인을 위해 사람이 맞는지 확인해 주세요.');
        if (window.grecaptcha && window.grecaptcha.render) {
            window.loginCaptchaReady();
        } else if (!loading) {
            loading = true;
            var script = window.document.createElement('script');
            script.src = 'https://www.google.com/recaptcha/api.js?onload=loginCaptchaReady&render=explicit&hl=ko';
            script.async = true;
            script.defer = true;
            script.onerror = function () {
                message('사람 확인을 불러올 수 없습니다. 새로고침 후 다시 시도해 주세요.');
            };
            window.document.head.appendChild(script);
        }
    }
    window.LoginBotCheck = {
        beginSubmission: function () {
            if (submitting) return false;
            var runtime = 'unknown';
            try { runtime = window.navigator.webdriver ? 'automation' : 'browser'; } catch (ignored) { }
            $('#login-browser-runtime').val(runtime);
            if (required && (widget === null || !window.grecaptcha || !window.grecaptcha.getResponse(widget))) {
                message('사람이 맞는지 먼저 확인해 주세요.');
                return false;
            }
            submitting = true;
            return true;
        },
        finishSubmission: function () { submitting = false; },
        handleResult: function (data) {
            // A Google token is single-use even when the password is incorrect.
            reset();
            if (data.result === 'CAPTCHA_REQUIRED') { show(); return true; }
            return false;
        },
        networkError: function () {
            submitting = false;
            reset();
            message('로그인 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
    };
}(window, jQuery));
