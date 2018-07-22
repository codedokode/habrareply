function init() {
    initInjectCss();
    var btn = $('<button class="hr-start-btn btn btn_outline_grey btn_x-large">Загрузить ответы</button>');
    var userStats = $('.page-header .user-info__stats');
    if (!userStats.length) {
        console.error("Cannot find user stats block, maybe markup has changed");
        $('body').prepend(btn);
    } else {

        // Find buttons block
        var buttonsBlock = userStats.find('.user-info__buttons');
        if (!buttonsBlock.length) {
            // There is no buttons block for anonymous users
            buttonsBlock = $('<div class="user-info__buttons"></div>');
            userStats.append(buttonsBlock);
        }

        buttonsBlock.prepend(btn);
    }

    btn.on('click', function () {
        addOutline(btn, false);
        btn.text('Загрузка ответов…');
        function progress(done, errs, total) {
            btn.text('Загрузка (' + done + '/' + total +')' + (errs > 0 ? ' +' + errs + ' ош.' : ''));
        }

        var finish = processComments(progress);
        finish.then(function () {
            btn.text("✓ Ответы загружены");

            // Cache takes a lot of memory, so free it 
            loadPostDom.clearCache();
            loadPost.clearCache();
        }, function () {
            addOutline(btn, true);
            btn.text("✗ Ошибка");
            loadPostDom.clearCache();
            loadPost.clearCache();
        });
    });
}

if (document.readyState == 'interactive' || document.readyState == 'complete') {
    init();
} else {
    document.addEventListener('DOMContentLoaded', init);
}

function addOutline(btn, enable) {
    if (enable) {
        btn.addClass('btn_outline_grey');
    } else {
        btn.removeClass('btn_outline_grey');
    }
}

function processComments(progressFn) {
    var comments = $('#comments > li > .comment');
    var finishes = [];
    var done = 0;
    var errs = 0;
    var total = comments.length;

    comments.each(function (index, com) {
        com = $(com);
        var finish = processComment(com);
        finishes.push(finish);

        finish.then(null, function (e) {
            console.error("Comment process error: " + e.message);
            console.log(e);
        });

        finish.then(function () {
            done++;
            progressFn && progressFn(done, errs, total);
        }, function () {
            errs++;
            progressFn && progressFn(done, errs, total);
        });
    });

    // TODO: fails too early and clears cache too early
    return Promise.all(finishes);
}

function processComment(com) {
    var processed = com.attr('data-habrareplied');
    if (processed) {
        return Promise.resolve(true);
    }

    var m = /^comment_(\d+)$/.exec(com.attr('id') || '');
    if (!m) {
        return Promise.reject(new Error('Invalid id attribute'));
    }

    var id = m[1];
    var href = com.find('.icon_comment-anchor').first().attr('href');
    if (!href) {
        return Promise.reject(new Error("Cannot find link at comment " + id));
    }

    var postUrl = parsePostLink(href);
    if (!postUrl) {
        return Promise.reject(new Error('Cannot parse post link for comment ' + id));
    }

    var finish = loadPostDom(postUrl).then(function (dom) {
        var replies = findRepliesInPost(dom, id);
        replies = removeNestedComments(replies);
        fixLinkInReplies(replies, postUrl);

        var commentShell = com.closest('.content-list__item_comment');
        if (!commentShell.length) {
            throw new Error("Cannot find comment shell");
        }

        if (replies.length > 0) {
            var repliesWrap = $('<div class="hr-replies"></div>');
            commentShell.after(repliesWrap);
            repliesWrap.append(replies);
        }

        com.attr('data-habrareplied', 1);

        return true;
    });

    return finish;
}

function parsePostLink(url) {
    var m = /(\/post\/\d+\/|\/company\/[^?#]+\/)#/.exec(url);
    return m ? m[1] : null;
}

function loadPost(url) {
    if (loadPost.cache[url]) {
        return loadPost.cache[url];
    }

    var p = loadPostUncached(url);
    loadPost.cache[url] = p;

    p.then(null, function (e) {
        delete loadPost.cache[url];
        throw new Error("Error loading post " + url + ": " + e.message);
    });

    return p;
}

loadPost.clearCache = function () { 
    loadPost.cache = {};
};

// { postUrl => Promise<html> }
loadPost.cache = {};

function loadPostDom(url) {
    if (loadPostDom.cache[url]) {
        return loadPostDom.cache[url];
    }

    var p = loadPostUncached(url).then(function (html) {
        // Parse into DOM, very slowly
        return $(html);
    });

    p.then(null, function (e) {
        delete loadPostDom.cache[url];
        throw e;
    });

    loadPostDom.cache[url] = p;
    return p;
}

loadPostDom.clearCache = function () {
    loadPostDom.cache = {};
}

loadPostDom.cache = {};


var nextRequestTime = 0;

function loadPostUncached(url) {

    var now = Date.now();
    var WAIT = 900; // ms
    var fetchStartPromise;

    if (now < nextRequestTime) {
        var waitTime = Math.max(nextRequestTime - now, 0);
        // console.log("Wait: " + waitTime);
        nextRequestTime = nextRequestTime + WAIT;

        fetchStartPromise = new Promise(function (res, rej) {
            setTimeout(function () { res(true); }, waitTime);
        });
    } else {
        fetchStartPromise = Promise.resolve(true);
        nextRequestTime = now + WAIT;
    }

    var resp = fetchStartPromise.then(function () {
        return fetch(url);
    });

    var text = resp.then(function (response) {

        if (!response.ok) {
            throw new Error('Load ' + url + 'error: status ' + response.status);
        }

        return response.text();
    });

    return text;
}

function findRepliesInPost(dom, commentId) {
    var comment = dom.find('#comment_' + commentId);
    comment = comment.closest('.js-comment');

    if (!comment.length) {
        throw new Error('Cannot find comment ' + commentId + 'in post body');
    }

    var children = comment.children('ul.content-list_nested-comments').children('li');
    children = children.clone();
    return children;
}

function removeNestedComments(replies) {
    var replacement = '<div class="hr-more">Ответы на комментарий скрыты</div>';
    var nested = replies.children('ul.content-list_nested-comments');
    nested.has('.js-comment').replaceWith(replacement);

    return replies;
}

function fixLinkInReplies(replies, postUrl) {
    var linkTags = replies.find('a[href^="#"]');
    linkTags.each(function (index, link) {
        link = $(link);
        var href = link.attr('href') || '';

        if (href.match(/^#./)) {
            var newHref = postUrl + href;
            link.attr('href', newHref);
        }
    });
}

function initInjectCss() {
    var css = [
        '.hr-more { color: #999; margin-left: 30px; margin-top: 15px; font-size: 11px; }',
        '.hr-replies { margin: 10px 0 10px 280px; }',
        '.hr-replies .comment__message { font-size: 12px; }',
        '.hr-replies .user-info__nickname_small { font-size: 11px; }',
        '.hr-replies .comment__date-time  { font-size: 11px; }'
    ].join("\n");

    var style = $('<style>' + css + '</style>');
    $('head,body').first().append(style);
}
