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
        var UPDATE_EVERY = 3*1000; // retrieve update interval in millisecond
        var vm = this;
        var pagesManager = new PagesManager(POSTS_PER_PAGE, DEFAULT_ORDER, false),
            permalink = new Permalink(pagesManager, PERMALINK_DELIMITER);

        var stickyPagesManager = new PagesManager(STICKY_POSTS_PER_PAGE, DEFAULT_ORDER, true),
            stickyPermalink = new Permalink(stickyPagesManager, PERMALINK_DELIMITER);

        function retrieveUpdate() {
            return vm.pagesManager.retrieveUpdate().then(function(data) {
                vm.pagesManager.updateLatestDates(data._items);
                if (vm.timeline) {
                    //handle posts one by one
                    angular.forEach(data._items, function(post) {
                        //check if we have the post in the timeline
                        var timelineId = false;
                        angular.forEach(vm.timeline.config.events, function(event) {
                            if (post._id === event._id) {
                                timelineId = event.unique_id;
                            }
                        });
                        if (timelineId) {
                            //post exists in timeline
                            if (post.post_status !== 'open' || post.deleted) {
                                //pust has ben removed or status has been changed
                                vm.timeline.removeId(timelineId);
                            } else {
                                //@TODO check for sticky status only change?
                                //for now we'll consider it an edit
                                vm.timeline.removeId(timelineId);
                                vm.timeline.add(createTimelineEvent(post));
                            }
                        } else {
                            if (post.post_status === 'open') {
                                //only add published items
                                vm.timeline.add(createTimelineEvent(post));
                            }
                        }
                    });
                } else {
                    //create timeline with array of published posts
                    var pubPosts = [];
                    angular.forEach(data._items, function(post) {
                        if (post.post_status === 'open' && !post.deleted) {
                            pubPosts.push(post);
                        }
                    });
                    createTimeline(pubPosts);
                }
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
                "_id": post._id,
                "display_date": moment(post.published_date).format(config.settings.datetimeFormat),
                "text": {
                    "text": html
                }
            }
            return event;
        }

        function createTimeline(posts) {
            if (vm.timeline) {
                //timeline already instantiated; we add events
                angular.forEach(posts, function(post) {
                    vm.timeline.add(createTimelineEvent(post));
                });
            } else {
                //check if we have any posts
                if (posts.length) {
                    var timelineEvents = {
                        events: []
                    }
                    angular.forEach(posts, function(post) {
                        timelineEvents.events.push(createTimelineEvent(post));
                    })
                    vm.timeline = new $window.TL.Timeline('liveblog-timeline', timelineEvents);
                } else {
                    //can't instantiate timelinejs with no events
                }
            }
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
                vm.loading = true;
                return vm.pagesManager.fetchNewPage().then(function(data){
                
                    vm.loading = false;
                    vm.finished = data._meta.total <= data._meta.max_results * data._meta.page;
                    createTimeline(data._items);

                    //get the first sticky page only once
                    vm.stickyPagesManager.fetchNewPage().then(function(data){
                        createTimeline(data._items);
                        
                    });
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
