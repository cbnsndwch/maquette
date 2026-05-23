/**
 * @type {import('npm-check-updates').RunOptions}
 */
module.exports = {
    reject: [
        // we'll upgrade Node manually when it's time
        '@types/node',
    ],

    packageManager: 'pnpm',
    deep: true
};
