const path = require('path')
const fs = require('fs').promises

const config = require('./config')
const { copyDirRecursiveAsync } = require('./fs')

async function readDir(dir, allFiles = []) {
  const files = (await fs.readdir(dir)).map((file) => path.join(dir, file))
  allFiles.push(...files)
  await Promise.all(files.map(async (file) => (await fs.stat(file)).isDirectory() && readDir(file, allFiles)))
  return allFiles
}

async function syncLocalContent() {
  const src = path.join(config.docs.srcPath)
  const destination = path.join(config.docs.outputPath)

  await copyDirRecursiveAsync(src, destination)
  console.log(`Docs synced to ${destination}`)

  const files = await readDir(destination)
  const mdFiles = files
    .filter((file) => {
      return file.endsWith('.md')
    })
    .map((file) => {
      return removeMarkDownLinks(file)
    })

  await Promise.all(mdFiles)
}

async function removeMarkDownLinks(filePath) {
  const content = await fs.readFile(filePath, 'utf-8')
  const newContent = content.replace(/(\w+)\.md/gm, '$1').replace(/\/docs\/commands\//gm, '/commands/')
  // Rename README.md to index.md
  if (path.basename(filePath) === 'README.md') {
    const newPath = path.join(path.dirname(filePath), 'index.md')
    // Delete README.md from docs site
    await fs.unlink(filePath)
    // Write index.md
    await fs.writeFile(newPath, newContent)
    return newPath
  }
  await fs.writeFile(filePath, newContent)
  return filePath
}

syncLocalContent().then(() => {
  console.log('Synced!')
})
