"use strict";
var OKSDK = (function () {
    const OK_CONNECT_URL = 'https://connect.ok.ru/';
    const OK_MOB_URL = 'https://m.ok.ru/';
    const OK_API_SERVER = 'https://api.ok.ru/';

    const MOBILE = 'mobile';
    const WEB = 'web';
    const NATIVE_APP = 'application';
    const EXTERNAL = 'external';

    const PLATFORM_REGISTER = {
        'w': WEB,
        'm': MOBILE,
        'a': NATIVE_APP,
        'e': EXTERNAL
    };
    var state = {
        app_id: 0, app_key: '',
        sessionKey: '', accessToken: '', sessionSecretKey: '', apiServer: '', widgetServer: '',
        baseUrl: '',
        container: false,
        header_widget: ''
    };
    var sdk_success = nop;
    var sdk_failure = nop;
    var rest_counter = 0;

    // ---------------------------------------------------------------------------------------------------
    // General
    // ---------------------------------------------------------------------------------------------------

    /**
     * initializes the SDK<br/>
     * If launch parameters are not detected, switches to OAUTH (via redirect)
     *
     * @param args
     * @param {Number} args.app_id application id
     * @param {String} args.app_key application key
     * @param [args.oauth] - OAUTH configuration
     * @param {String} [args.oauth.scope='VALUABLE_ACCESS'] scope
     * @param {String} [args.oauth.url=location.href] return url
     * @param {String} [args.oauth.state=''] state for security checking
     * @param {String} [args.oauth.layout='a'] authorization layout (w - web, m - mobile)
     * @param {Function} success success callback
     * @param {Function} failure failure callback
     */
    function init(args, success, failure) {
        args.oauth = args.oauth || {};
        sdk_success = isFunc(success) ? success : nop;
        sdk_failure = isFunc(failure) ? failure : nop;

        var params = getRequestParameters(args['location_search'] || window.location.search);
        var hParams = getRequestParameters(args['location_hash'] || window.location.hash);

        state.app_id = args.app_id;
        state.app_key = params["application_key"] || args.app_key;

        if (!state.app_id || !state.app_key) {
            sdk_failure('Required arguments app_id/app_key not passed');
            return;
        }

        state.sessionKey = params["session_key"];
        state.accessToken = hParams['access_token'];
        state.groupId = params['group_id'] || hParams['group_id'] || args['group_id'];
        state.sessionSecretKey = params["session_secret_key"] || hParams['session_secret_key'];
        state.apiServer = args["api_server"] || params["api_server"] || OK_API_SERVER;
        state.widgetServer = args["widget_server"] || params['widget_server'] || OK_CONNECT_URL;
        state.baseUrl = state.apiServer + "fb.do";
        state.header_widget = params['header_widget'];
        state.container = params['container'];
        state.layout = (params['layout'] || hParams['layout'])
            || (params['api_server']
                ? (params['apiconnection']
                    ? 'w'
                    : 'm')
                : args.layout);

        if (!params['api_server']) {
            if ((hParams['access_token'] == null) && (hParams['error'] == null)) {
                window.location = state.widgetServer + 'oauth/authorize' +
                    '?client_id=' + args.app_id +
                    '&scope=' + (args.oauth.scope || 'VALUABLE_ACCESS') +
                    '&response_type=' + 'token' +
                    '&redirect_uri=' + (args.oauth.url || window.location.href) +
                    '&layout=' + (args.oauth.layout || 'a') +
                    '&state=' + (args.oauth.state || '');
                return;
            }
            if (hParams['error'] != null) {
                sdk_failure('Error with OAUTH authorization: ' + hParams['error']);
                return;
            }
        }


        sdk_success();
    }

    // ---------------------------------------------------------------------------------------------------
    // REST
    // ---------------------------------------------------------------------------------------------------

    function restLoad(url) {
        var script = document.createElement('script');
        script.src = url;
        script.async = true;
        var done = false;
        script.onload = script.onreadystatechange = function () {
            if (!done && (!this.readyState || this.readyState === "loaded" || this.readyState === "complete")) {
                done = true;
                script.onload = null;
                script.onreadystatechange = null;
                if (script && script.parentNode) {
                    script.parentNode.removeChild(script);
                }
            }
        };
        var headElem = document.getElementsByTagName('head')[0];
        headElem.appendChild(script);
    }

    /**
     * Calls a REST request
     *
     * @param {String} method
     * @param {Object} [params]
     * @param {restCallback} [callback]
     * @param {Object} [callOpts]
     * @param {boolean} [callOpts.no_session] true if REST method prohibits session
     * @param {boolean} [callOpts.no_sig] true if no signature is required for the method
     * @param {string} [callOpts.app_secret_key] required for non-session requests
     * @returns {string}
     */
    function restCall(method, params, callback, callOpts) {
        var query = "?";
        params = params || {};
        params.method = method;
        params = restFillParams(params);
        if (callOpts && callOpts.no_session) {
            delete params['session_key'];
            delete params['access_token'];
        }
        if (!callOpts || !callOpts.no_sig) {
            var secret = (callOpts && callOpts.app_secret_key) ? callOpts.app_secret_key : state.sessionSecretKey;
            params['sig'] = calcSignature(params, secret);
        }

        for (var key in params) {
            if (params.hasOwnProperty(key)) {
                query += key + "=" + encodeURIComponent(params[key]) + "&";
            }
        }
        var callbackId = "__oksdk__callback_" + (++rest_counter);
        window[callbackId] = function (status, data, error) {
            if (isFunc(callback)) {
                callback(status, data, error);
            }
            window[callbackId] = null;
            try {
                delete window[callbackId];
            } catch (e) {}
        };
        restLoad(state.baseUrl + query + "js_callback=" + callbackId);
        return callbackId;
    }

    /**
     * Calculates request signature basing on the specified call arguments
     *
     * @param {Object} query
     * @param {string} [secretKey] alternative secret_key (fe: app secret key for non-session requests)
     * @returns {string}
     */
    function calcSignatureExternal(query, secretKey) {
        return calcSignature(restFillParams(query), secretKey);
    }

    function calcSignature(query, secretKey) {
        var i, keys = [];
        for (i in query) {
            keys.push(i.toString());
        }
        keys.sort();
        var sign = "";
        for (i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (("sig" != key) && ("access_token" != key)) {
                sign += keys[i] + '=' + query[keys[i]];
            }
        }
        sign += secretKey || state.sessionSecretKey;
        sign = encodeUtf8(sign);
        return md5(sign);
    }

    function restFillParams(params) {
        params = params || {};
        params["application_key"] = state.app_key;
        if (state.sessionKey) {
            params["session_key"] = state.sessionKey;
        } else {
            params["access_token"] = state.accessToken;
        }
        params["format"] = 'JSON';
        return params;
    }

    function wrapCallback(success, failure, dataProcessor) {
        return function(status, data, error) {
            if (status == 'ok') {
                if (isFunc(success)) success(isFunc(dataProcessor) ? dataProcessor(data) : data);
            } else {
                if (isFunc(failure)) failure(error);
            }
        };
    }

    // ---------------------------------------------------------------------------------------------------
    // Payment
    // ---------------------------------------------------------------------------------------------------

    function paymentShow(productName, productPrice, productCode, options) {
        var params = {};
        params['name'] = productName;
        params['price'] = productPrice;
        params['code'] = productCode;

        options = options || {};
        const host = options['mob_pay_url'] || OK_MOB_URL;

        params["application_key"] = state.app_key;
        if (state.sessionKey) {
            params["session_key"] = state.sessionKey;
        } else {
            params["access_token"] = state.accessToken;
        }
        params['sig'] = calcSignature(params, state.sessionSecretKey);

        var query = host + 'api/show_payment?';
        for (var key in params) {
            if (params.hasOwnProperty(key)) {
                query += key + "=" + encodeURIComponent(params[key]) + "&";
            }
        }

        window.open(query);
    }

    // ---------------------------------------------------------------------------------------------------
    // Widgets
    // ---------------------------------------------------------------------------------------------------

    const WIDGET_SIGNED_ARGS = ["st.attachment", "st.return", "st.redirect_uri", "st.state"];

    /**
     * Returns HTML to be used as a back button for mobile app<br/>
     * If back button is required (like js app opened in browser from native mobile app) the required html
     * will be returned in #onSucсess callback
     * @param {onSuccessCallback} onSuccess
     * @param {String} [style]
     */
    function widgetBackButton(onSuccess, style) {
        if (state.container || state.accessToken) return;
        restCall('widget.getWidgetContent',
            {wid: state.header_widget || 'mobile-header-small', style: style || null},
            wrapCallback(onSuccess, null, function(data) {
                return decodeUtf8(atob(data))
            }));
    }

    /**
     * Opens mediatopic post widget
     *
     * @param {String} returnUrl callback url
     * @param {Object} options options
     * @param {Object} options.attachment mediatopic (feed) to be posted
     */
    function widgetMediatopicPost(returnUrl, options) {
        options = options || {};
        if (!options.attachment) {
            options = {attachment: options}
        }
        options.attachment = btoa(unescape(encodeURIComponent(toString(options.attachment))));
        widgetOpen('WidgetMediatopicPost', options, returnUrl);
    }

    /**
     * Opens app invite widget (invite friends to app)
     *
     * @see widgetSuggest widgetSuggest() for more details on arguments
     */
    function widgetInvite(returnUrl, options) {
        widgetOpen('WidgetInvite', options, returnUrl);
    }

    /**
     * Opens app suggest widget (suggest app to friends, both already playing and not yet)
     *
     * @param {String} returnUrl callback url
     * @param {Object} [options] options
     * @param {int} [options.autosel] amount of friends to be preselected
     * @param {String} [options.comment] default text set in the suggestion text field
     * @param {String} [options.custom_args] custom args to be passed when app opened from suggestion
     * @param {String} [options.state] custom args to be passed to return url
     * @param {String} [options.target] comma-separated friend IDs that should be preselected by default
     */
    function widgetSuggest(returnUrl, options) {
        widgetOpen('WidgetSuggest', options, returnUrl);
    }

    function widgetOpen(widget, args, returnUrl) {
        args = args || {};
        args.return = args.return || returnUrl;
        var popupConfig = args.popupConfig;
        var popup;

        if (popupConfig) {
            var w = popupConfig.width;
            var h = popupConfig.height;
            var documentElement = document.documentElement;
            if (typeof popupConfig.left == 'undefined') {
                var screenLeft = window.screenLeft;
                var innerWidth = window.innerWidth;
                var screenOffsetLeft = typeof screenLeft == 'undefined' ? screen.left : screenLeft;
                var screenWidth = innerWidth ? innerWidth : documentElement.clientWidth ? documentElement.clientWidth : screen.width;
                var left = (screenWidth / 2 - w / 2) + screenOffsetLeft;
            }
            if (typeof popupConfig.top == 'undefined') {
                var screenTop = window.screenTop;
                var screenOffsetTop = typeof screenTop == 'undefined'? screen.top : screenTop;
                var innerHeight = window.innerHeight;
                var screenHeight = innerHeight ? innerHeight : documentElement.clientHeight ? documentElement.clientHeight : screen.height;
                var top = (screenHeight / 2 - h / 2) + screenOffsetTop;
            }

            var popupName = popupConfig.name + Date.now();
            popup = window.open(
                getLinkOnWidget(widget, args),
                popupName,
                'width=' + w + ',' +
                'height=' + h + ',' +
                'top=' + top + ',' +
                'left=' + left +
                (popupConfig.options ? (',' + popupConfig.options) : '')
            );

        } else {
            popup = window.open(getLinkOnWidget(widget, args));
        }

        return popup;
    }

    function getLinkOnWidget(widget, args) {
        var keys = [];
        for (var arg in args) {
            keys.push(arg.toString());
        }
        keys.sort();

        var sigSource = '';
        var query = state.widgetServer +
            'dk?st.cmd=' + widget +
            '&st.app=' + state.app_id;

        if (state.groupId) {
            query += '&st.groupId=' + state.groupId;
        }

        for (var i = 0; i < keys.length; i++) {
            var key = "st." + keys[i];
            var val = args[keys[i]];
            if (WIDGET_SIGNED_ARGS.indexOf(key) != -1) {
                sigSource += key + "=" + val;
            }
            query += "&" + key + "=" + encodeURIComponent(val);
        }
        sigSource += state.sessionSecretKey;
        query += '&st.signature=' + md5(sigSource);
        if (state.accessToken != null) {
            query += '&st.access_token=' + state.accessToken;
        }
        if (state.sessionKey) {
            query += '&st.session_key=' + state.sessionKey;
        }
        return query;
    }

    // ---------------------------------------------------------------------------------------------------
    // SDK constructor
    // ---------------------------------------------------------------------------------------------------

    function WidgetConfigurator(widgetName) {
        this.name = widgetName;
        this.adapters = {};
        this.uiLayerName = null;
    }

    WidgetConfigurator.prototype = {
        withUiLayerName: function(name) {
            this.uiLayerName = name;
            return this;
        },
        withUiAdapter: function(fn) {
            this.adapters.uiAdapter = fn;
            return this;
        },
        withPopupAdapter: function(fn) {
            this.adapters.popupAdapter = fn;
            return this;
        },
        withIframeAdapter: function(fn) {
            this.adapters.iframeAdapter = fn;
            return this;
        }
    };

    function WidgetLayerBuilder(widget, options) {
        if (widget instanceof WidgetConfigurator && widget.name && !this.handlerConfMap[widget.name]) {
            WidgetLayerBuilder.prototype.handlerConfMap[widget.name] = widget;
            this.handlerConf = widget;
            this.widgetName = widget.name;
        } else {
            this.handlerConf = this.handlerConfMap[widget] || {};
            this.widgetName = widget;
        }

        this.options = options;

        if (this.handlerConf) {
            var adapters = this.handlerConf.adapters;
            if (adapters) {
                this.adapters = {
                    openPopup: adapters.popupAdapter,
                    openUiLayer: adapters.uiAdapter,
                    openIframeLayer: adapters.iframeAdapter
                };
            } else {
                this.adapters = {};
            }
            this.resolveContext();
        }
    }

    WidgetLayerBuilder.prototype = {
        performRedirect: function (redirectUrl, redirectCondition) {
            this.redirectUrl = redirectUrl ? redirectUrl : this.options.redirectUrl;
            this.redirectCondition = isFunc(redirectCondition) ? redirectCondition : trueCondition;
        },
        callContext: {
            layout: undefined,
            isOAuth: null,
            isOKApp: null,
            isPopup: null,
            isIframe: null,
            isExternal: null
        },
        handlerConfMap: {
            'WidgetGroupAppPermissions': {},
            'WidgetMediatopicPost':
                new WidgetConfigurator('WidgetMediatopicPost')
                    .withUiLayerName('postMediatopic') /* see: FAPI.UI.*, https://apiok.ru/search?q=FAPI.UI */
                    .withUiAdapter(
                        function (data, options) {
                            return [data.uiLayerName, options.attachment];
                        }
                    ),
            'WidgetInvite': {},
            'WidgetSuggest': {}
        },
        validatorRegister: {
            openUiLayer: [uiLayerCheck],
            openIframeLayer: [iframeLayerCheck],
            openPopup: [popupCheck]
        },
        validateAndRun: function () {
            var validatorRegister = this.validatorRegister;
            for (var method in validatorRegister) {
                if (validatorRegister.hasOwnProperty(method)) {
                    var result = true;
                    var conditionsArray = validatorRegister[method];
                    // todo:  add custom check
                    //if (this.conditions) {
                    //    conditionsArray.concat(this.conditions[method]);
                    //}
                    for (var i = 0, l = conditionsArray.length; i < l; i++) {
                        if (conditionsArray[i]) {
                            result = conditionsArray[i].apply(this);
                        }
                    }

                    // убеждаемся, что такой метод есть в прототипе конструтора
                    if (result && (!this.hasOwnProperty(method) && method in this)) {
                        var adapter = this.adapters[method];
                        if (adapter) {
                            this.options = adapter(this.handlerConf, this.options);
                        }
                        return this[method]();
                    }
                }
            }
        },
        openPopup: function () {
            return widgetOpen(this.widgetName, this.options);
        },
        openUiLayer: function () {
            return invokeUIMethod.apply(null, this.options);
        },
        openIframeLayer: function () {
            return window.console && console.log('Iframe-layer is in development');
        },
        resolveContext: resolveContext,
        changeParams: function (options) {
            if (this.options) {
                mergeObject(this.options, options, true);
                return this;
            } else {
                return this.configure(options);
            }
        },
        addParams: function (options) {
            if (this.options) {
                mergeObject(this.options, options, false);
                return this;
            } else {
                return this.configure(options);
            }
        },
        configure: function (options) {
            this.options = options;
            return this;
        },
        run: function () {
            var redirectCondition = this.redirectCondition;
            if (redirectCondition && redirectCondition(state)) {
                window.location.href = this.redirectUrl;
            }
            return this.validateAndRun();
        }
    };




    function uiLayerCheck() {
        var context = this.callContext;
        return this.handlerConf.uiLayerName && !(context.isExternal || context.isMob);
    }

    function iframeLayerCheck() {
        return false;
    }

    function popupCheck() {
        return true;
    }

    var trueCondition = function () {
        return true;
    };

    /* todo: виджеты в леере
    function createIframe(uri, customCssClass) {
        var iframe = document.createElement('iframe');
        var iframeClassName = typeof customCssClass === 'undefined' ? "" : customCssClass;
        iframe.src = uri;
        iframe.className = ("ok-sdk-frame " + iframeClassName);

        document.body.appendChild(iframe);

        //iframe.contentWindow.postMessage({'test-message': 7}, "*")
    }
    */

    function invokeUIMethod() {
        var argStr = "";
        for (var i = 0, l = arguments.length; i < l; i++) {
            var arg = arguments[i];

            if (i > 0) {
                argStr += '$';
            }
            if (arg != null) {
                argStr += encodeURIComponent(String(arg));
            }
        }
        window.parent.postMessage("__FAPI__" + argStr, "*");
    }

    /**
     * @class WidgetLayerBuilder
     *
     * @returns {Object} context
     * @returns {Boolean} context.platform
     * @returns {Boolean} context.isOKApp
     * @returns {Boolean} context.isOauth
     * @returns {Boolean} context.isIframe
     * @returns {Boolean} context.isExternal
     */
    function resolveContext() {
        var stateMode = state.layout && state.layout.toLowerCase();
        var context = {
            layout: PLATFORM_REGISTER[stateMode],
            isOKApp: state.container || false,
            isOAuth: stateMode === 'o',
            isIframe: window.parent !== window,
            isPopup: !!window.opener
        };
        context.isExternal = context.layout == EXTERNAL || !(context.isIframe || context.isPopup || context.isOAuth);
        context.isMob = context.layout == WEB || context.layout == NATIVE_APP;
        this.callContext = context;
    }


    // ---------------------------------------------------------------------------------------------------
    // Utils
    // ---------------------------------------------------------------------------------------------------

    /**
     * calculates md5 of a string
     * @param {String} str
     * @returns {String}
     */
    function md5(str) {
        const hex_chr = "0123456789abcdef";

        function rhex(num) {
            let str = "";
            for (let j = 0; j <= 3; j++) {
                str += hex_chr.charAt((num >> (j * 8 + 4)) & 0x0F) +
                    hex_chr.charAt((num >> (j * 8)) & 0x0F);
            }
            return str;
        }

        /*
         * Convert a string to a sequence of 16-word blocks, stored as an array.
         * Append padding bits and the length, as described in the MD5 standard.
         */
        function str2blks_MD5(str) {
            let nblk = ((str.length + 8) >> 6) + 1;
            let blks = new Array(nblk * 16);
            let i = 0;
            for (i = 0; i < nblk * 16; i++) {
                blks[i] = 0;
            }
            for (i = 0; i < str.length; i++) {
                blks[i >> 2] |= str.charCodeAt(i) << ((i % 4) * 8);
            }
            blks[i >> 2] |= 0x80 << ((i % 4) * 8);
            blks[nblk * 16 - 2] = str.length * 8;
            return blks;
        }

        /*
         * Add integers, wrapping at 2^32. This uses 16-bit operations internally
         * to work around bugs in some JS interpreters.
         */
        function add(x, y) {
            let lsw = (x & 0xFFFF) + (y & 0xFFFF);
            let msw = (x >> 16) + (y >> 16) + (lsw >> 16);
            return (msw << 16) | (lsw & 0xFFFF);
        }

        /*
         * Bitwise rotate a 32-bit number to the left
         */
        function rol(num, cnt) {
            return (num << cnt) | (num >>> (32 - cnt));
        }

        /*
         * These functions implement the basic operation for each round of the
         * algorithm.
         */
        function cmn(q, a, b, x, s, t) {
            return add(rol(add(add(a, q), add(x, t)), s), b);
        }

        function ff(a, b, c, d, x, s, t) {
            return cmn((b & c) | ((~b) & d), a, b, x, s, t);
        }

        function gg(a, b, c, d, x, s, t) {
            return cmn((b & d) | (c & (~d)), a, b, x, s, t);
        }

        function hh(a, b, c, d, x, s, t) {
            return cmn(b ^ c ^ d, a, b, x, s, t);
        }

        function ii(a, b, c, d, x, s, t) {
            return cmn(c ^ (b | (~d)), a, b, x, s, t);
        }

        let x = str2blks_MD5(str);
        let a = 1732584193;
        let b = -271733879;
        let c = -1732584194;
        let d = 271733878;

        for (let i = 0; i < x.length; i += 16) {
            const olda = a;
            const oldb = b;
            const oldc = c;
            const oldd = d;

            a = ff(a, b, c, d, x[i + 0], 7, -680876936);
            d = ff(d, a, b, c, x[i + 1], 12, -389564586);
            c = ff(c, d, a, b, x[i + 2], 17, 606105819);
            b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
            a = ff(a, b, c, d, x[i + 4], 7, -176418897);
            d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
            c = ff(c, d, a, b, x[i + 6], 17, -1473231341);
            b = ff(b, c, d, a, x[i + 7], 22, -45705983);
            a = ff(a, b, c, d, x[i + 8], 7, 1770035416);
            d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
            c = ff(c, d, a, b, x[i + 10], 17, -42063);
            b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
            a = ff(a, b, c, d, x[i + 12], 7, 1804603682);
            d = ff(d, a, b, c, x[i + 13], 12, -40341101);
            c = ff(c, d, a, b, x[i + 14], 17, -1502002290);
            b = ff(b, c, d, a, x[i + 15], 22, 1236535329);

            a = gg(a, b, c, d, x[i + 1], 5, -165796510);
            d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
            c = gg(c, d, a, b, x[i + 11], 14, 643717713);
            b = gg(b, c, d, a, x[i + 0], 20, -373897302);
            a = gg(a, b, c, d, x[i + 5], 5, -701558691);
            d = gg(d, a, b, c, x[i + 10], 9, 38016083);
            c = gg(c, d, a, b, x[i + 15], 14, -660478335);
            b = gg(b, c, d, a, x[i + 4], 20, -405537848);
            a = gg(a, b, c, d, x[i + 9], 5, 568446438);
            d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
            c = gg(c, d, a, b, x[i + 3], 14, -187363961);
            b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
            a = gg(a, b, c, d, x[i + 13], 5, -1444681467);
            d = gg(d, a, b, c, x[i + 2], 9, -51403784);
            c = gg(c, d, a, b, x[i + 7], 14, 1735328473);
            b = gg(b, c, d, a, x[i + 12], 20, -1926607734);

            a = hh(a, b, c, d, x[i + 5], 4, -378558);
            d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
            c = hh(c, d, a, b, x[i + 11], 16, 1839030562);
            b = hh(b, c, d, a, x[i + 14], 23, -35309556);
            a = hh(a, b, c, d, x[i + 1], 4, -1530992060);
            d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
            c = hh(c, d, a, b, x[i + 7], 16, -155497632);
            b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
            a = hh(a, b, c, d, x[i + 13], 4, 681279174);
            d = hh(d, a, b, c, x[i + 0], 11, -358537222);
            c = hh(c, d, a, b, x[i + 3], 16, -722521979);
            b = hh(b, c, d, a, x[i + 6], 23, 76029189);
            a = hh(a, b, c, d, x[i + 9], 4, -640364487);
            d = hh(d, a, b, c, x[i + 12], 11, -421815835);
            c = hh(c, d, a, b, x[i + 15], 16, 530742520);
            b = hh(b, c, d, a, x[i + 2], 23, -995338651);

            a = ii(a, b, c, d, x[i + 0], 6, -198630844);
            d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
            c = ii(c, d, a, b, x[i + 14], 15, -1416354905);
            b = ii(b, c, d, a, x[i + 5], 21, -57434055);
            a = ii(a, b, c, d, x[i + 12], 6, 1700485571);
            d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
            c = ii(c, d, a, b, x[i + 10], 15, -1051523);
            b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
            a = ii(a, b, c, d, x[i + 8], 6, 1873313359);
            d = ii(d, a, b, c, x[i + 15], 10, -30611744);
            c = ii(c, d, a, b, x[i + 6], 15, -1560198380);
            b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
            a = ii(a, b, c, d, x[i + 4], 6, -145523070);
            d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
            c = ii(c, d, a, b, x[i + 2], 15, 718787259);
            b = ii(b, c, d, a, x[i + 9], 21, -343485551);

            a = add(a, olda);
            b = add(b, oldb);
            c = add(c, oldc);
            d = add(d, oldd);
        }
        return rhex(a) + rhex(b) + rhex(c) + rhex(d);
    }

    /**
     *
     * @param oldObj {Object}    obj where copy to
     * @param newObj {Object}    obj where copied from
     * @param rewrite {Boolean} [rewrite = true]
     * @returns {*}
     */
    function mergeObject(oldObj, newObj, rewrite) {
        for (var k in newObj) {
            if (newObj.hasOwnProperty(k)) {
                if (oldObj.hasOwnProperty(k) && typeof rewrite !== 'undefined' && !rewrite) {
                    continue;
                }
                var property = newObj[k];
                if (getClass(property) === '[object Object]') {
                    mergeObject(oldObj[k] = oldObj[k] || {}, property, rewrite);
                } else {
                    oldObj[k] = property;
                }
            }
        }

        return oldObj;
    }

    function getClass(o) {
        return Object.prototype.toString.call(o);
    }

    function isFunc(obj) {
        return getClass(obj) === "[object Function]";
    }

    function isString(obj) {
        return Object.prototype.toString.call(obj) === "[object String]";
    }

    function toString(obj) {
        return isString(obj) ? obj : JSON.stringify(obj);
    }

    /**
     * Parses parameters to a JS map<br/>
     * Supports both window.location.search and window.location.hash)
     * @param {String} [source=window.location.search] string to parse
     * @returns {Object}
     */
    function getRequestParameters(source) {
        var res = {};
        var url = source || window.location.search;
        if (url) {
            url = url.substr(1);    // Drop the leading '?' / '#'
            var nameValues = url.split("&");

            for (var i = 0; i < nameValues.length; i++) {
                var nameValue = nameValues[i].split("=");
                var name = nameValue[0];
                var value = nameValue[1];
                value = value && decodeURIComponent(value.replace(/\+/g, " "));
                res[name] = value;
            }
        }
        return res;
    }

    function encodeUtf8(string) {
        var res = "";
        for (var n = 0; n < string.length; n++) {
            var c = string.charCodeAt(n);
            if (c < 128) {
                res += String.fromCharCode(c);
            }
            else if ((c > 127) && (c < 2048)) {
                res += String.fromCharCode((c >> 6) | 192);
                res += String.fromCharCode((c & 63) | 128);
            }
            else {
                res += String.fromCharCode((c >> 12) | 224);
                res += String.fromCharCode(((c >> 6) & 63) | 128);
                res += String.fromCharCode((c & 63) | 128);
            }
        }
        return res;
    }

    function decodeUtf8(utftext) {
        var string = "";
        var i = 0;
        var c = 0, c2 = 0, c3 = 0;
        while (i < utftext.length) {
            c = utftext.charCodeAt(i);
            if (c < 128) {
                string += String.fromCharCode(c);
                i++;
            }
            else if ((c > 191) && (c < 224)) {
                c2 = utftext.charCodeAt(i + 1);
                string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
                i += 2;
            } else {
                c2 = utftext.charCodeAt(i + 1);
                c3 = utftext.charCodeAt(i + 2);
                string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
                i += 3;
            }
        }
        return string;
    }

    /** stub func */
    function nop() {
    }

    // ---------------------------------------------------------------------------------------------------
    return {
        init: init,
        REST: {
            call: restCall,
            calcSignature: calcSignatureExternal
        },
        Payment: {
            show: paymentShow
        },
        Widgets: {
            Builder: WidgetLayerBuilder,
            WidgetConfigurator: WidgetConfigurator,
            getBackButtonHtml: widgetBackButton,
            post: widgetMediatopicPost,
            invite: widgetInvite,
            suggest: widgetSuggest
        },
        Util: {
            md5: md5,
            encodeUtf8: encodeUtf8,
            decodeUtf8: decodeUtf8,
            encodeBase64: btoa,
            decodeBase64: atob,
            getRequestParameters: getRequestParameters,
            toString: toString,
            mergeObject: mergeObject
        }
    };
})();
