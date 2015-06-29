
exports.register = function(server, options, done) {
  var url = require('url');
  var qs = require('querystring');
  var request = require('request');
  var pageRenderUrl = process.env.PAGE_RENDER_URL;
  var req;

  function buildPageRenderUrl(user, project, page) {
    var urlObj = url.parse(pageRenderUrl);

    urlObj.hash = '#/thumbnail?' + qs.encode({
      user: user,
      project: project,
      page: page,
      t: Date.now()
    });

    return '/mobile-center-cropped/small/webmaker-desktop/' + new Buffer(url.format(urlObj)).toString('base64');
  }

  function dropCache(project, user, tail) {
    server.methods.projects.findOne.cache.drop([project, user], function(err) {
      if ( err ) {
        server.log('error', {
          message: 'failed to invalidate cache for project ' + project,
          error: err
        });
      }
      tail();
    });
  }

  function updateThumbnail(project, user, url, tail) {
    server.methods.projects.updateThumbnail(
      [
        JSON.stringify({
          320: url
        }),
        project
      ],
      function(err, result) {
        if ( err ) {
          server.log('error', {
            details: 'Error updating project thumbnail',
            error: err
          });
        }

        dropCache(project, user, tail);
      }
    );
  }

  function generateThumbnail(row, tail) {
    req({
      url: buildPageRenderUrl(row.user_id, row.project_id, row.page_id)
    }, function(err, resp, body) {
      if ( err ) {
        server.log('error', {
          details: 'Error requesting a new thumnail from the screenshot service',
          error: err
        });
        return tail();
      }

      if ( resp.statusCode !== 200 ) {
        server.log('error', {
          details: 'Thumbnail service returned ' + resp.statusCode,
          error: body
        });
        return tail(new Error('Thumbnail update failed'));
      }

      updateThumbnail(row.project_id, row.user_id, body.screenshot, tail);
    });
  }

  // Check if the given page has the lowest id in its parent project
  // If it is, then request a new thumbnail
  function checkPageId(page, tail) {
    if ( !process.env.THUMBNAIL_SERVICE_URL ) {
      return tail();
    }

    server.methods.pages.min([
      page.project_id
    ], function(err, result) {
      if ( err ) {
        server.log('error', {
          details: 'Error querying DB for lowest page ID in project: ' + page.project_id,
          error: err
        });
        return tail(err);
      }
      var row = result.rows[0];

      if ( row.page_id !== page.id ) {
        server.debug('Thumbnail update not required');
        return tail();
      }

      server.debug('Updating thumbnail for project');
      generateThumbnail(row, tail);
    });
  }

  req = request.defaults({
    baseUrl: process.env.THUMBNAIL_SERVICE_URL,
    method: 'post',
    json: true,
    headers: {
      accept: 'application/json'
    },
    body: {
      wait: true
    }
  });

  server.method('projects.checkPageId', checkPageId);
  done();
};

exports.register.attributes = {
  name: 'webmaker-thumnails',
  version: '1.0.0'
};
