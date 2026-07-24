set shell := ['/bin/zsh', '-eu', '-o', 'pipefail', '-c']

# A fully static, single-player browser app — no server, no secrets in the repo.
# Players paste their own OpenRouter key at runtime (cached in localStorage).

help: ## Show available commands
	@just --list

install: ## Install npm dependencies
	npm install

dev: ## Run Vite with HMR and open http://localhost:5173
	npm run dev -- --host 127.0.0.1 --strictPort > /tmp/redliner-protocol-dev.log 2>&1 &
	sleep 1
	open http://127.0.0.1:5173/
	@echo 'Dev server with HMR running at http://127.0.0.1:5173/ (use Ctrl-C in its process or stop it separately.)'

build: ## Production static build to dist/ (deploy anywhere: GitHub Pages, Vercel, ...)
	npm run build

preview: build ## Build and serve the production build at http://localhost:4173
	npm run preview -- --host 127.0.0.1 --strictPort

run: build ## Build, serve, and open the production build
	npm run preview -- --host 127.0.0.1 --strictPort > /tmp/redliner-protocol-preview.log 2>&1 &
	sleep 1
	open http://127.0.0.1:4173/
	@echo 'Preview server running at http://127.0.0.1:4173/ (Ctrl-C will not stop the background server; use pkill -f "vite preview" if needed.)'

# Quality gates.
check: ## Type-check everything (client + shared + tests)
	npm run check

test: ## Run unit + headless sim tests
	npm test

test-watch: ## Run tests in watch mode
	npm run test:watch

verify: check test build ## Full gate: types, tests, and a clean production build

deploy: verify ## Push main — GitHub Actions publishes to GitHub Pages
	git push origin main
	@echo 'Pushed — GitHub Actions will publish to https://doctorkhan.github.io/ProtoRed/'

clean: ## Remove build output and caches
	rm -rf dist node_modules/.vite
	@echo 'clean'
