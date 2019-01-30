/**
 * A content script that is injected into Habr.com's profile page.
 */
if (document.readyState == 'interactive' || document.readyState == 'complete') {
    init();
} else {
    document.addEventListener('DOMContentLoaded', init);
}

function init() {
    initInjectCss();

    // Add a button to the page
    var btn = $('<button class="hr-start-btn btn btn_outline_grey btn_x-large">Загрузить ответы</button>');
    var userStatsBlock = $('.page-header .user-info__stats');
    if (!userStatsBlock.length) {
        console.error("Cannot find user stats block, maybe markup has changed");
        $('body').prepend(btn);
    } else {

        // Find buttons block
        var buttonsBlock = userStatsBlock.find('.user-info__buttons');
        if (!buttonsBlock.length) {
            // There is no buttons block for anonymous users, so add it ourselves
            buttonsBlock = $('<div class="user-info__buttons"></div>');
            userStatsBlock.append(buttonsBlock);
        }

        buttonsBlock.prepend(btn);
    }

    btn.on('click', function () {

        function displayProgress(done, errs, total) {
            btn.text('Загрузка (' + done + '/' + total +')' + (errs > 0 ? ' +' + errs + ' ош.' : ''));
        }

        addOutlineForButton(btn, false);
        btn.text('Загрузка ответов…');
        var finish = processComments(displayProgress);

        finish.then(function () {
            btn.text("✓ Ответы загружены");

            // Cache takes a lot of memory, so free it 
            loadPostDom.clearCache();
        }, function () {
            addOutlineForButton(btn, true);
            btn.text("✗ Ошибка");
            loadPostDom.clearCache();
        });
    });
}

/**
 * Adds styles to the page
 */
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

function addOutlineForButton(btn, enable) {
    if (enable) {
        btn.addClass('btn_outline_grey');
    } else {
        btn.removeClass('btn_outline_grey');
    }
}

/**
 * Walk through comments on the page and load replies for each one.
 */
function processComments(onProgress) {
    var comments = $('#comments > li > .comment');
    var finishPromises = [];
    var done = 0;
    var errs = 0;
    var total = comments.length;

    comments.each(function (index, comment) {
        comment = $(comment);
        var finished = processComment(comment);
        finishPromises.push(finished);

        finished.then(null, function (e) {
            console.error("Comment process error: " + e.message);
            console.log(e);
        });

        finished.then(function () {
            done++;
            onProgress && onProgress(done, errs, total);
        }, function () {
            errs++;
            onProgress && onProgress(done, errs, total);
        });
    });

    // TODO: fails too early and clears cache too early
    return Promise.all(finishPromises);
}

/**
 * Loads and displays replies for a single comment
 */
function processComment(comment) {
    var alreadyProcessed = comment.attr('data-habrareplied');
    if (alreadyProcessed) {
        return Promise.resolve(true);
    }

    var m = /^comment_(\d+)$/.exec(comment.attr('id') || '');
    if (!m) {
        return Promise.reject(new Error('Invalid id attribute'));
    }

    var id = m[1];
    var href = comment.find('.icon_comment-anchor').first().attr('href');
    if (!href) {
        return Promise.reject(new Error("Cannot find link at comment " + id));
    }

    var postUrl = extractPostUrl(href);
    if (!postUrl) {
        return Promise.reject(new Error('Cannot parse post URL for comment ' + id));
    }

    var finished = loadPostDom(postUrl).then(function (dom) {
        var replies = findRepliesInPost(dom, id);
        replies = removeNestedComments(replies);
        fixHashUrlsInReplies(replies, postUrl);

        var commentShell = comment.closest('.content-list__item_comment');
        if (!commentShell.length) {
            throw new Error("Cannot find comment shell");
        }

        if (replies.length > 0) {
            var repliesWrap = $('<div class="hr-replies"></div>');
            commentShell.after(repliesWrap);
            repliesWrap.append(replies);
        }

        comment.attr('data-habrareplied', 1);

        return true;
    });

    return finished;
}

function extractPostUrl(url) {
    var m = /(\/post\/\d+\/|\/company\/[^?#]+\/)#/.exec(url);
    return m ? m[1] : null;
}

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

    var responsePromise = fetchStartPromise.then(function () {
        return fetch(url);
    });

    var htmlPromise = responsePromise.then(function (response) {

        if (!response.ok) {
            throw new Error('Fetch ' + url + ', error: status ' + response.status);
        }

        return response.text();
    });

    return htmlPromise;
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

function fixHashUrlsInReplies(replies, postUrl) {
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
