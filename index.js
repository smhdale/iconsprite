#!/usr/bin/env node

const fs = require('fs/promises')
const path = require('path')
const readline = require('readline')

const { optimize } = require('svgo')
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')

function parseArgs() {
	return yargs(hideBin(process.argv))
		.command(
			'$0 [--prefix] [--outfile] [--overwrite] <files..>',
			'Creates an icon sprite from a set of SVG files',
			(yargs) => yargs
				.positional('files', {
					describe: 'SVG files to compile',
					coerce: (files) => files ? files.map((file) => resolve(file)) : undefined,
				})
		)
		.option('prefix', {
			alias: 'p',
			type: 'string',
			describe: 'Prefix to add to sprite IDs',
		})
		.option('outfile', {
			alias: 'o',
			type: 'string',
			describe: 'Write result to a file (writes to stdout if omitted)',
			coerce: (file) => file ? resolve(file) : undefined,
		})
		.option('overwrite', {
			alias: 'y',
			type: 'boolean',
			describe: 'Overwrites outfile if specified',
			default: false,
		})
		.parse()
}

function resolve(file) {
	if (file.startsWith('/')) return file
	else return path.resolve(process.cwd(), file)
}

function slugify(name, namespace = '') {
	const fullName = namespace ? `${namespace}-${name}` : name
	return fullName
		.replace(/[^a-z0-9 _-]/ig, '')
		.replace(/([^ _-])([A-Z])/g, '$1-$2')
		.replace(/[ _]/g, '-')
		.replace(/(^[^a-z0-9]+|[^a-z0-9]+$)/ig, '')
		.toLowerCase()
}

function minify(svg) {
	return optimize(svg, {
		plugins: [
			{
				name: 'preset-default',
				params: {
					overrides: {
						removeViewBox: false,
					}
				}
			},
			'removeXMLNS',
			'convertStyleToAttrs',
			'sortAttrs',
			'removeDimensions',
		]
	}).data
}

function svgToSymbol(slug, svg) {
	return svg
		.replace('<svg', `<symbol id="${slug}"`)
		.replace('</svg>', '</symbol>')
		.replace(/(fill|stroke)="(?!none).+?"/ig, '$1="currentColor"')
}

async function iconsprite(files, namespace = '') {
	const iconsMap = new Map()

	const loadFile = async (file) => {
		const ext = path.extname(file)
		const name = slugify(path.basename(file, ext), namespace)

		if (ext !== '.svg') {
			console.log('Ignoring non-SVG file:', file)
		} else {
			let contents
			try {
				contents = await fs.readFile(file)
				iconsMap.set(name, minify(contents))
			} catch (err) {
				console.warn("Error reading input file:", file)
				process.exit(1)
			}
		}
	}

	// Load all SVG files
	await Promise.all(files.map((file) => loadFile(file)))

	// Sort icons
	const icons = [...iconsMap.entries()]
	icons.sort(([a], [b]) => a.localeCompare(b))

	// Inject into output SVG
	const symbols = icons.map((icon) => svgToSymbol(...icon)).join('')
	const sprite = `<svg xmlns="http://www.w3.org/2000/svg">${symbols}</svg>`

	return optimize(sprite, {
		js2svg: {
			indent: '\t',
			pretty: true,
		},
		plugins: [],
	}).data
}

async function awaitOverwrite(outfile) {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
	return new Promise((resolve) => {
		rl.question(`Output file "${outfile}" exists; overwrite? (y/N) `, (answer) => {
			rl.close()
			resolve(answer.toLowerCase() === 'y')
		})
	})
}

async function main() {
	const { files, prefix, outfile, overwrite } = parseArgs()
	const sprite = await iconsprite(files, prefix)

	// No outfile specified; write to STDOUT
	if (outfile === undefined) return console.log(sprite)

	// Check if output file exists, and if we should overwrite
	try {
		const stats = await fs.stat(outfile)
		if (stats.isFile() && !overwrite) {
			const shouldOverwrite = await awaitOverwrite(outfile)
			if (!shouldOverwrite) {
				console.log('Cancelled.')
				process.exit(1);
			}
		}
	} catch (err) {
		// File doesn't exist; do nothing
	}

	// Write to output file
	try {
		await fs.writeFile(outfile, sprite)
	} catch (err) {
		console.log('Failed to write icon sprite to output file.')
	}
}

main()
