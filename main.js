(function(angular) {
    'use strict';

    TimelineCtrl.$inject = ['$interval', 'PagesManager', 'blogs', 'config', '$anchorScroll', '$timeout', 'Permalink', 'transformBlog', 'gettext', '$window'];
    function TimelineCtrl($interval, PagesManager, blogsService, config, $anchorScroll, $timeout, Permalink, transformBlog, gettext, $window) {

        var POSTS_PER_PAGE = config.settings.postsPerPage;
        var STICKY_POSTS_PER_PAGE = 100;
        var PERMALINK_DELIMITER = config.settings.permalinkDelimiter || '?';
        var DEFAULT_ORDER = config.settings.postOrder; // newest_first, oldest_first or editorial
        var UPDATE_MANUALLY = config.settings.loadNewPostsManually;
        var UPDATE_STICKY_MANUALLY = typeof config.settings.loadNewStickyPostsManually === 
        'boolean' ? config.settings.loadNewStickyPostsManually : config.settings.loadNewPostsManually;
        var UPDATE_EVERY = 10*1000; // retrieve update interval in millisecond
        var vm = this;
        var pagesManager = new PagesManager(POSTS_PER_PAGE, DEFAULT_ORDER, false),
            permalink = new Permalink(pagesManager, PERMALINK_DELIMITER);

        var stickyPagesManager = new PagesManager(STICKY_POSTS_PER_PAGE, DEFAULT_ORDER, true),
            stickyPermalink = new Permalink(stickyPagesManager, PERMALINK_DELIMITER);

        function retrieveUpdate() {
            return vm.pagesManager.retrieveUpdate().then(function(data) {
                vm.newPosts = vm.newPosts.concat(vm.pagesManager.processUpdates(data, !UPDATE_MANUALLY));
                vm.newStickyPosts = vm.newStickyPosts.concat(vm.stickyPagesManager.processUpdates(data, !UPDATE_STICKY_MANUALLY));
            });
        }

        function retrieveBlogSettings() {
            blogsService.get({}, function(blog) {
                if(blog.blog_status === 'closed') {
                    $interval.cancel(vm.interval.posts);
                    $interval.cancel(vm.interval.blog);
                }
                angular.extend(vm.blog, blog);
            });
        }

        function createTimelineEvent(post) {
            var html = '';
            angular.forEach(post.items, function(item) {
                if (html == '') {
                    html += item.text;
                } else {
                    html += '<br />' + item.text;
                }
            });
            var event = {
                "start_date": {
                    "month": moment(post.published_date).format('MM'),
                    "day": moment(post.published_date).format('D'),
                    "year": moment(post.published_date).format('YYYY'),
                    "hour": moment(post.published_date).format('H'),
                    "minute": moment(post.published_date).format('m')
                },
                "display_date": moment(post.published_date).format(config.settings.datetimeFormat),
                "text": {
                    "text": html
                }
            }
            return event;
        }

        // define view model
        angular.extend(vm, {
            templateDir: config.assets_root,
            blog: transformBlog(config.blog),
            loading: true,
            finished: false,
            highlightsOnly: false,
            settings: config.settings,
            newPosts: [],
            newStickyPosts: [],
            sortOptions: [{
                name: gettext('Editorial'),
                order: 'editorial'
            }, {
                name: gettext('Newest first'),
                order: 'newest_first'
            }, {
                name: gettext('Oldest first'),
                order: 'oldest_first'
            }],
            orderBy: function(order_by) {
                vm.loading = true;
                vm.finished = false;
                vm.pagesManager.changeOrder(order_by).then(function(data) {
                    vm.loading = false;
                    vm.finished = data._meta.total <= data._meta.max_results * data._meta.page;
                });
            },
            fetchNewPage: function() {
                console.log(config.settings);
                vm.loading = true;
                return vm.pagesManager.fetchNewPage().then(function(data){
                    var timelineEvents = {
                        events: []
                    };
                    vm.loading = false;
                    vm.finished = data._meta.total <= data._meta.max_results * data._meta.page;
                    
                    angular.forEach(data._items, function(post) {
                        timelineEvents.events.push(createTimelineEvent(post));
                    })
                    vm.timeline = new $window.TL.Timeline('liveblog-timeline', timelineEvents);

                    //get the first sticky page only once
                    vm.stickyPagesManager.fetchNewPage().then(function(data){
                        angular.forEach(data._items, function(post) {
                            vm.timeline.add(createTimelineEvent(post));
                        })
                    });
                    // TODO: notify updates
                });
            },
            permalinkScroll: function() {
                vm.loading = true;
                vm.permalink.loadPost().then(function(id){
                    $anchorScroll(id);
                    vm.loading = false;
                }, function(){
                    vm.loading = false;
                });
            },
            isAllowedToLoadMore: function() {
                return !vm.loading && !vm.finished;
            },
            applyUpdates: function() {
                pagesManager.applyUpdates(vm.newPosts, true);
                vm.newPosts = [];
                stickyPagesManager.applyUpdates(vm.newStickyPosts, true);
                vm.newStickyPosts = [];
            },
            toggleHighlighsOnly: function() {
                vm.highlightsOnly = !vm.highlightsOnly;
                vm.loading = true;
                vm.finished = false;
                stickyPagesManager.changeHighlight(vm.highlightsOnly);
                pagesManager.changeHighlight(vm.highlightsOnly).then(function(data) {
                    vm.loading = false;
                    vm.finished = data._meta.total <= data._meta.max_results * data._meta.page;
                });
                if (vm.highlightsOnly) {
                    stickyPagesManager.hideSticky = false;
                }
            },
            pagesManager: pagesManager,
            permalink: permalink,
            stickyPagesManager: stickyPagesManager,
            stickyPermalink: stickyPermalink
        });

        // retrieve regular first page
        vm.fetchNewPage()
        // retrieve updates periodically
        .then(function() {
            vm.permalinkScroll();
            if(vm.blog.blog_status !== 'closed') {
                vm.interval = {
                    posts: $interval(retrieveUpdate, UPDATE_EVERY),
                    blog: $interval(retrieveBlogSettings, 3 * UPDATE_EVERY)
                };
            }
            // listen events from parent
            var fetchNewPageDebounced = _.debounce(vm.fetchNewPage, 1000);
            function receiveMessage(event) {
                if (event.data === 'loadMore') {
                    fetchNewPageDebounced();
                }
            }
            window.addEventListener('message', receiveMessage, false);
        });
    }

    angular.module('theme', ['liveblog-embed', 'ngAnimate', 'infinite-scroll', 'gettext'])
        .run(['gettextCatalog', 'config', function (gettextCatalog, config) {
            gettextCatalog.setCurrentLanguage(config.settings.language);
        }])
        .run(['$rootScope', function($rootScope){
            angular.element(document).on("click", function(e) {
                $rootScope.$broadcast("documentClicked", angular.element(e.target));
            });
        }])
        .controller('TimelineCtrl', TimelineCtrl)
        .directive('lbItem', ['asset', function(asset) {
            return {
                restrict: 'AE',
                scope: {
                    ident: '=',
                    item: '='
                },
                templateUrl: asset.templateUrl('views/item.html'),
            }
        }])
        .directive('lbAuthor', ['asset', function(asset) {
            return {
                restrict: 'AE',
                scope: {
                    item: '=',
                    timeline: '='
                },
                templateUrl: asset.templateUrl('views/author.html'),
            }
        }])
        .directive('lbPosts', ['asset', function(asset) {
            return {
                restrict: 'E',
                scope: {
                    posts: '=',
                    timeline: '='
                },
                templateUrl: asset.templateUrl('views/posts.html'),
            }
        }]);
    angular.module('infinite-scroll').value('THROTTLE_MILLISECONDS', 1000);

})(angular);
