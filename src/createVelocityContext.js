'use strict';

const jsEscapeString = require('js-string-escape');
const { decode } = require('jsonwebtoken');
const objectFromEntries = require('object.fromentries');
const jsonPath = require('./jsonPath.js');
const { createUniqueId, isPlainObject } = require('./utils/index.js');

objectFromEntries.shim();

const { parse, stringify } = JSON;
const { entries, fromEntries } = Object;

function escapeJavaScript(x) {
  if (typeof x === 'string') {
    return jsEscapeString(x).replace(/\\n/g, '\n'); // See #26,
  }

  if (isPlainObject(x)) {
    const result = fromEntries(
      entries(x).map(([key, value]) => [key, jsEscapeString(value)]),
    );

    return stringify(result); // Is this really how APIG does it?
  }

  if (typeof x.toString === 'function') {
    return escapeJavaScript(x.toString());
  }

  return x;
}

/*
  Returns a context object that mocks APIG mapping template reference
  http://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-mapping-template-reference.html
*/
module.exports = function createVelocityContext(request, options, payload) {
  const path = (x) => jsonPath(payload || {}, x);
  const authPrincipalId =
    request.auth && request.auth.credentials && request.auth.credentials.user;
  const headers = request.unprocessedHeaders;

  let token = headers && (headers.Authorization || headers.authorization);

  if (token && token.split(' ')[0] === 'Bearer') {
    [, token] = token.split(' ');
  }

  let claims;

  if (token) {
    try {
      claims = decode(token) || undefined;
    } catch (err) {
      // Nothing
    }
  }

  return {
    context: {
      apiId: 'offlineContext_apiId',
      authorizer: {
        claims,
        principalId:
          authPrincipalId ||
          process.env.PRINCIPAL_ID ||
          'offlineContext_authorizer_principalId', // See #24
      },
      httpMethod: request.method.toUpperCase(),
      identity: {
        accountId: 'offlineContext_accountId',
        apiKey: 'offlineContext_apiKey',
        caller: 'offlineContext_caller',
        cognitoAuthenticationProvider:
          'offlineContext_cognitoAuthenticationProvider',
        cognitoAuthenticationType: 'offlineContext_cognitoAuthenticationType',
        sourceIp: request.info.remoteAddress,
        user: 'offlineContext_user',
        userAgent: request.headers['user-agent'] || '',
        userArn: 'offlineContext_userArn',
      },
      requestId: `offlineContext_requestId_${createUniqueId()}`,
      resourceId: 'offlineContext_resourceId',
      resourcePath: request.route.path,
      stage: options.stage,
    },
    input: {
      body: payload, // Not a string yet, todo
      json: (x) => stringify(path(x)),
      params: (x) =>
        typeof x === 'string'
          ? request.params[x] || request.query[x] || headers[x]
          : {
              header: headers,
              path: Object.assign({}, request.params),
              querystring: Object.assign({}, request.query),
            },
      path,
    },
    stageVariables: options.stageVariables,
    util: {
      base64Decode: (x) =>
        Buffer.from(x.toString(), 'base64').toString('binary'),
      base64Encode: (x) =>
        Buffer.from(x.toString(), 'binary').toString('base64'),
      escapeJavaScript,
      parseJson: parse,
      urlDecode: (x) => decodeURIComponent(x.replace(/\+/g, ' ')),
      urlEncode: encodeURI,
    },
  };
};
