/**
Провайдер AnyBalance (http://any-balance-providers.googlecode.com)
*/

var g_headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Charset': 'windows-1251,utf-8;q=0.7,*;q=0.3',
    'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.6,en;q=0.4',
    'Connection': 'keep-alive',
    'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/29.0.1547.66 Safari/537.36',
    'Origin': 'https://mydom.velcom.by',
};

// Сайт требует разлогиниваться безопасно, чтобы входить в аккаунт чаще чем раз в 5 минут
function logOutSafe(baseurl) {
    AnyBalance.trace('Выходим из личного кабинета...');
    return AnyBalance.requestPost(baseurl, {}, addHeaders({ Referer: baseurl }));
}

function replaceSpaces(_text) {
    return _text.replace(/\s+/g, '');
}

function parseBalanceRK(_text) {
    var text = _text.replace(/\s+/g, '');
    var rub = getParam(text, null, null, /(-?\d[\d\.,]*)р/i, replaceTagsAndSpaces, parseBalance) || 0;
    var _sign = rub < 0 || /-\d[\d\.,]*р/i.test(text) ? -1 : 1;
    var kop = getParam(text, null, null, /(-?\d[\d\.,]*)к/i, replaceTagsAndSpaces, parseBalance) || 0;
    var val = _sign * (Math.abs(rub) + kop / 100);
    AnyBalance.trace('Parsing balance (' + val + ') from: ' + _text);
    return val;
}

function getHTML(str) {
    var parser = new DOMParser();
    return parser.parseFromString(str, 'text/html');
}

function parseTable(tempHtml) {
    var userInfoDict = {};
    var childrens = tempHtml.getElementById('elements').children[0].children;
    for (var i = 0; i < childrens.length; i++) {
        var child = childrens[i];
        if (child.children.length > 1) {
            userInfoDict[child.children[0].children[0].innerHTML] = child.children[1].children[0].innerHTML;
        }
    }

    return userInfoDict;
}

function main() {
    var prefs = AnyBalance.getPreferences();

    checkEmpty(prefs.login, 'Введите логин!');
    checkEmpty(prefs.password, 'Введите пароль!');

    var baseurl = 'https://mydom.velcom.by/';
    var personalPage = 'https://my.velcom.by/work.html';
    var asmpAction = 'https://asmp.velcom.by/asmp/ProcessLoginServlet/srv-aaa1-prod/srv-b2b1-prod?aaacookie=srv-aaa1-prod&eacookie=srv-b2b1-prod';
    var asmpLogin = 'https://asmp.velcom.by/asmp/LoginMasterServlet?userRequestURL=' + encodeURIComponent(encodeURIComponent(personalPage)) + '&serviceRegistrationURL=&service=ISSA&wrongLoginType=false&cookie=skip&level=30';
    var asmpLogOut = 'https://asmp.velcom.by/asmp/logout?reloginDisableAutologin=https%3A//my.velcom.by/'

    AnyBalance.setDefaultCharset('utf-8');

    var html = AnyBalance.requestGet(asmpLogin, g_headers);

    try {
        html = AnyBalance.requestPost(asmpAction, {
            UserIDFixed: prefs.login,
            UserID: '+375 ' + prefs.login,
            mobilePassword: prefs.password,
            fixedPassword: prefs.password,
            fixednet: true,
            service: 'ISSA',
            userRequestURL: personalPage,
            serviceRegistrationURL: '',
            level: 30,
            SetMsisdn: false
        }, addHeaders({ Referer: asmpLogin, 'Content-Type': 'application/x-www-form-urlencoded' }));

        if (!/Главное меню/i.test(html)) {
            var error = getParam(html, null, null, /<h1[^>]*>Вход в систему<\/h1>[\s\S]*?class="redmsg mesg"[^>]*>([\s\S]*?)<\//i, replaceTagsAndSpaces);
            if (error)
                throw new AnyBalance.Error(error, null, /Введенные данные неверны/i.test(error));

            AnyBalance.trace(html);
            throw new AnyBalance.Error('Не удалось зайти в личный кабинет. Сайт изменен?');
        }

        html = AnyBalance.requestPost(personalPage, { user_input_0: '_root/PERSONAL_INFO_FISICAL' }, g_headers);
        if (!/Персональная информация/i.test(html)) {
            var error = getParam(html, null, null, /<h1[^>]*>Вход в систему<\/h1>[\s\S]*?class="redmsg mesg"[^>]*>([\s\S]*?)<\//i, replaceTagsAndSpaces);
            if (error)
                throw new AnyBalance.Error(error, null, /Введенные данные неверны/i.test(error));

            AnyBalance.trace(html);
            throw new AnyBalance.Error('Не удалось зайти в личный кабинет. Сайт изменен?');
        }

        var result = { success: true };
        var tempHtml = getHTML(html);;
        var dict = parseTable(tempHtml);

        result['balance'] = parseBalanceRK(dict['Баланс лицевого счета:']);
        result['fio'] = dict['ФИО:'];
        result['acc'] = replaceSpaces(dict['Лицевой счет:']);
        result['tp'] = dict['Тарифный план:'];

        if (isAvailable(['trafic', 'trafic_total'])) {
            var hrefs = sumParam(html, null, null, /<a href="\/([^"]+)"[^>]*>статистика/ig);

            AnyBalance.trace('Найдено ссылок на статистику: ' + hrefs.length);

            for (var i = 0; i < hrefs.length; i++) {
                AnyBalance.trace('Получаем данные по трафику... попытка №' + (i + 1));

                html = AnyBalance.requestGet(baseurl + hrefs[i], g_headers);

                getParam(html, result, 'trafic_total', /Кол-во трафика в интернет(?:[^>]*>){2}([\s\S]*?)<\//i, replaceTagsAndSpaces, parseTraffic);
                getParam(html, result, 'trafic', /<th>\s*<\/th>(?:[^>]*>){9}([\d.,]+)/i, [replaceTagsAndSpaces, /(.*)/i, '$1 мб'], parseTraffic);
                getParam(html, result, 'trafic', /(?:<th>[^>]*<\/th>){3}\s*<\/tr>\s*<\/table>/i, [replaceTagsAndSpaces, /([\d.,]+)/i, '$1 мб'], parseTraffic);

                if (isset(result.trafic_total) || isset(result.trafic)) {
                    AnyBalance.trace('Нашли данные по трафику с попытки №' + (i + 1));
                    break;
                }
            }
        }
    } catch (e) {
        throw e;
    } finally {
        logOutSafe(asmpLogOut);
    }

    AnyBalance.setResult(result);
}