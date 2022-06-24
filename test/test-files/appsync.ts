import * as appsync from "@aws-cdk/aws-appsync-alpha";
import { GraphqlApi } from "@aws-cdk/aws-appsync-alpha";
import { App, aws_events, Stack } from "aws-cdk-lib";
import { AppsyncResolver, EventBus, Function, StepFunction } from "../../src";

const app = new App({
  autoSynth: false,
});
const stack = new Stack(app, "stack");

const api = new appsync.GraphqlApi(stack, "API", {
  name: "api",
});

new AppsyncResolver(
  stack,
  "getPost",
  {
    api,
    typeName: "Query",
    fieldName: "getPost",
  },
  // valid - inline arrow function
  () => null
);

new AppsyncResolver(
  stack,
  "getPost",
  {
    api,
    typeName: "Query",
    fieldName: "getPost",
  },
  // valid - inline function expression
  function () {
    return null;
  }
);

const f = () => null;
new AppsyncResolver(
  stack,
  "getPost",
  {
    api,
    typeName: "Query",
    fieldName: "getPost",
  },
  // invalid - must be an inline function
  f
);

new AppsyncResolver(
  stack,
  "getPost",
  {
    api,
    typeName: "Query",
    fieldName: "getPost",
  },
  // invalid - must be an inline function
  (
    () => () =>
      null
  )()
);

// nested

new AppsyncResolver(
  stack,
  "getPost",
  {
    api,
    typeName:
      "Query" +
      // nonsensical, but... just go with it
      new AppsyncResolver(
        stack,
        "getPost",
        { api, typeName: "Query", fieldName: "getPost" },
        // invalid - must be an inline function
        (
          () => () =>
            null
        )()
      ).resolvers.length,
    fieldName: "getPost",
  },
  () => null
);

// Unsupported - non-awaited promise

const func = new Function<undefined, string>(stack, "func", async () => {
  return "hello";
});

new AppsyncResolver(
  api,
  "no await",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    const c = func();
    return c;
  }
);

new AppsyncResolver(
  api,
  "deferred await",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    const c = func();
    const cc = await c;
    return cc;
  }
);

new AppsyncResolver(
  api,
  "then",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    return func().then((x) => x);
  }
);

new AppsyncResolver(
  api,
  "catch",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    return func().catch((x) => x);
  }
);

// Supported - Await

new AppsyncResolver(
  api,
  "await",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    const c = await func();
    return c;
  }
);

new AppsyncResolver(
  api,
  "await return",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    return func();
  }
);

new AppsyncResolver(
  api,
  "return",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    return func();
  }
);

// Unsupported - async map without promise all

new AppsyncResolver(
  api,
  "no promise array",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    return [1, 2].map(async () => func());
  }
);

new AppsyncResolver(
  api,
  "no promise all",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    const c = Promise.all([1, 2].map(async () => func()));
    return c;
  }
);

new AppsyncResolver(
  api,
  "no promise all await",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    const c = [1, 2];
    return Promise.all(c);
  }
);

// unsupported - new resources in closure

new AppsyncResolver(
  api,
  "new sfn",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    new StepFunction(stack, "", () => {});
  }
);

new AppsyncResolver(
  api,
  "new func",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    new Function(stack, "", async () => {});
  }
);

new AppsyncResolver(
  api,
  "new bus",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    new EventBus(stack, "");
  }
);

new AppsyncResolver(
  api,
  "new resolver",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    new AppsyncResolver(
      stack,
      "",
      {
        api: new GraphqlApi(stack, "", { name: "api" }),
        typeName: "type",
        fieldName: "field",
      },
      () => {}
    );
  }
);

new AppsyncResolver(
  api,
  "new aws bus",
  {
    fieldName: "field",
    typeName: "type",
  },
  async () => {
    new aws_events.EventBus(stack, "");
  }
);