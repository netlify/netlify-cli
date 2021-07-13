# Contributions

🎉 Thanks for considering contributing to this project! 🎉

These guidelines will help you send a pull request.

If you're submitting an issue instead, please skip this document.

If your pull request is related to a typo or the documentation being unclear, please click on the relevant page's `Edit`
button (pencil icon) and directly suggest a correction instead.

This project was made with ❤️. The simplest way to give back is by starring and sharing it online.

Everyone is welcome regardless of personal background. We enforce a [Code of conduct](CODE_OF_CONDUCT.md) in order to
promote a positive and inclusive environment.

## Development process

First fork and clone the repository. If you're not sure how to do this, please watch
[these videos](https://egghead.io/courses/how-to-contribute-to-an-open-source-project-on-github).

Run:

```bash
npm install && npm run site:build:install
```

Tests are run with:

```bash
npm test
```

**NOTE:**

Running some integration tests will require an active Netlify account to create a live site.

You can either provide a [Netlify Auth Token](https://docs.netlify.com/cli/get-started/#obtain-a-token-in-the-netlify-ui) (through the `NETLIFY_AUTH_TOKEN` environment variable) or login via `./bin/run login` before running the tests.

Running these tests won't result in any charges towards your Netlify account because they build a site locally and then deploy it.

> We don't recommend doing this, but you can disable these tests by setting the `NETLIFY_TEST_DISABLE_LIVE` environment variable to `true`.

In watch mode:

```bash
npm run watch
```

Make sure everything is correctly setup by running those tests first.

ESLint and Prettier are performed automatically on `git push`. However, we recommend you setup your IDE or text editor
to run ESLint and Prettier automatically on file save. Otherwise, you should run them manually using:

```bash
npm run format
```

Alternatively you can setup your IDE to integrate with Prettier and ESLint for JavaScript and Markdown files.

To run the CLI locally:

```bash
./bin/run [command]
```

## Architecture

The CLI is written using the [oclif](https://oclif.io/) cli framework and the [netlify/js-client](https://github.com/netlify/js-client) open-api derived API client.

- Commands live in the [`src/commands`](src/commands) folder.
- The base command class which provides consistent config loading and an API client lives in [`src/utils/command.js`](src/utils/command.js).
- Small utilities and other functionality live in [`src/utils`](src/utils).

A good place to start is reading the base command README and looking at the commands folder.

### Testing

This repo uses [ava](https://github.com/avajs/ava) for testing. Any files in the `src` directory that have a `.test.js` file extension are automatically detected and run as tests.

We also test for a few other things:

- Dependencies (used and unused)
- Linting
- Test coverage
- Must work with Windows + Unix environments.

### Lint docs per Netlify style guide

1. [Install vale](https://docs.errata.ai/vale/install)
2. Download the latest styles to the styles directory. For example: `wget -q -O styles.zip https://vale-library.netlify.app/styles.zip && unzip styles.zip -d .github/styles && rm styles.zip`
3. Run vale: `vale docs src README.md CODE_OF_CONDUCT.md CONTRIBUTING.md`

## Pull Requests

We actively welcome your pull requests.

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Run `npm test` to run linting, formatting and tests.
5. Make sure to sync the docs by running `npm run docs`.

## Releasing

Merge the release PR

### Creating a prerelease

1. Create a branch named `releases/<tag>/<version>` with the version and tag you'd like to release.
2. Push the branch to the repo.

For example, a branch named `releases/rc/4.0.0` will create the version `v4.0.0-rc` and publish it under the `rc` tag.

## License

By contributing to Netlify Node Client, you agree that your contributions will be licensed
under its [MIT license](LICENSE).
