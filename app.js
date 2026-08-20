import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// This page is wired to the "Triangle IT Support" Supabase project - a
// SEPARATE project from the one Spark's Phone Sync uses, so an employee
// account here has zero access to any personal Spark data. The
// publishable key is meant to be public (Supabase's own docs: "safe to
// use in a browser") - real access control is Row Level Security on the
// tables themselves (see supabase/triangle_it_support_schema.sql).
const SUPABASE_URL = 'https://rtytofraoboczpelvpqi.supabase.co'
const SUPABASE_KEY = 'sb_publishable_IPyRE7yRASw-Mh_jVk5uXA_4ztmmS3H'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const authScreen = document.getElementById('auth-screen')
const appScreen = document.getElementById('app-screen')
const authForm = document.getElementById('auth-form')
const authError = document.getElementById('auth-error')
const authHint = document.getElementById('auth-hint')
const authSubmitBtn = document.getElementById('auth-submit-btn')
const logoutBtn = document.getElementById('logout-btn')
const adminTabBtn = document.getElementById('admin-tab-btn')
const loadingOverlay = document.getElementById('loading-overlay')
const userIdentity = document.getElementById('user-identity')

// Mirrors Spark's own company -> department pick-lists (services/
// settings_store.py, "companies" / "departments_by_company") so
// tickets submitted here line up with the same taxonomy Spark uses.
const DEPARTMENTS_BY_COMPANY = {
  TPS: ['Sales', 'Supply Chain', 'Estimation', 'Finance', 'Management', 'Project Management', 'Other'],
  TCT: ['Operations TCT', 'Traders TCT', 'Finance TCT', 'Risk TCT'],
  Other: ['Sales', 'Supply Chain', 'Estimation', 'Finance', 'Management', 'Project Management', 'Other'],
}

const newCompanySelect = document.getElementById('new-company')
const newDepartmentSelect = document.getElementById('new-department')

Object.keys(DEPARTMENTS_BY_COMPANY).forEach((company) => {
  const opt = document.createElement('option')
  opt.textContent = company
  newCompanySelect.appendChild(opt)
})

function refreshDepartmentOptions() {
  newDepartmentSelect.innerHTML = ''
  DEPARTMENTS_BY_COMPANY[newCompanySelect.value].forEach((dept) => {
    const opt = document.createElement('option')
    opt.textContent = dept
    newDepartmentSelect.appendChild(opt)
  })
}

newCompanySelect.addEventListener('change', refreshDepartmentOptions)
refreshDepartmentOptions()

let currentUserId = null
let isAdmin = false

function nowIso() {
  return new Date().toISOString()
}

function showLoading() { loadingOverlay.classList.remove('hidden') }
function hideLoading() { loadingOverlay.classList.add('hidden') }

function statusClass(status) {
  return 'status-' + (status || 'open').toLowerCase().replace(/\s+/g, '-')
}

// Deliberately different from Spark's own format_ticket_ref() ("T#0007")
// so a ticket that started on the website is recognizable at a glance,
// including later once it's pulled into Spark's Tickets tab (M5).
function ticketRef(ticket) {
  return 'W-T#' + String(ticket.ticket_number).padStart(4, '0')
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// ============================== Auth ================================

let authMode = 'signin'

document.querySelectorAll('.auth-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    authMode = btn.dataset.mode
    authSubmitBtn.textContent = authMode === 'signin' ? 'Sign In' : 'Sign Up'
    authError.textContent = ''
    authHint.classList.add('hidden')
  })
})

authForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  authError.textContent = ''
  authHint.classList.add('hidden')

  const email = document.getElementById('auth-email').value.trim()
  const password = document.getElementById('auth-password').value

  if (authMode === 'signup') {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) {
      authError.textContent = error.message
      return
    }
    authHint.classList.remove('hidden')
    return
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    authError.textContent = error.message
    return
  }

  await enterApp()
})

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut()
  currentUserId = null
  isAdmin = false
  appScreen.classList.add('hidden')
  authScreen.classList.remove('hidden')
})

async function enterApp() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  currentUserId = session.user.id
  userIdentity.textContent = session.user.email

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', currentUserId)
    .single()

  isAdmin = !!(profile && profile.is_admin)
  adminTabBtn.classList.toggle('hidden', !isAdmin)

  authScreen.classList.add('hidden')
  appScreen.classList.remove('hidden')

  loadMyTickets()
  if (isAdmin) loadAdminTickets()
}

supabase.auth.getSession().then(({ data }) => {
  if (data.session) enterApp()
})

// ============================== Tabs ================================

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'))
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active')
  })
})

// ============================== Submit ticket ================================

document.getElementById('submit-ticket-form').addEventListener('submit', async (e) => {
  e.preventDefault()

  const title = document.getElementById('new-title').value.trim()
  if (!title) return

  const fields = {
    title,
    description: document.getElementById('new-description').value.trim(),
    company: newCompanySelect.value,
    department: newDepartmentSelect.value,
    category: document.getElementById('new-category').value,
    office: document.getElementById('new-office').value,
    status: 'Open',
    solution: '',
    created_at: nowIso(),
    updated_at: nowIso(),
  }

  showLoading()
  const { error } = await supabase.from('tickets').insert(fields)
  hideLoading()

  if (error) {
    alert('Could not submit ticket: ' + error.message)
    return
  }

  e.target.reset()
  refreshDepartmentOptions()
  document.querySelector('.tab-btn[data-tab="mine"]').click()
  loadMyTickets()
})

// ============================== My tickets ================================

async function loadMyTickets() {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('submitted_by', currentUserId)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error(error)
    return
  }

  renderTicketList(document.getElementById('mine-list'), data, false)
}

// ============================== Admin dashboard ================================

;['filter-status', 'filter-company', 'filter-office', 'filter-category'].forEach((id) => {
  document.getElementById(id).addEventListener('change', loadAdminTickets)
})

async function loadAdminTickets() {
  let query = supabase.from('tickets').select('*').order('updated_at', { ascending: false })

  const status = document.getElementById('filter-status').value
  const company = document.getElementById('filter-company').value
  const office = document.getElementById('filter-office').value
  const category = document.getElementById('filter-category').value

  if (status) query = query.eq('status', status)
  if (company) query = query.eq('company', company)
  if (office) query = query.eq('office', office)
  if (category) query = query.eq('category', category)

  const { data, error } = await query

  if (error) {
    console.error(error)
    return
  }

  renderTicketList(document.getElementById('admin-list'), data, true)
}

// ============================== Rendering ================================

function renderTicketList(listEl, tickets, adminMode) {
  listEl.innerHTML = ''

  if (tickets.length === 0) {
    const li = document.createElement('li')
    li.className = 'empty-hint'
    li.textContent = 'No tickets yet.'
    listEl.appendChild(li)
    return
  }

  tickets.forEach((ticket) => {
    const li = document.createElement('li')
    li.className = 'ticket-card'

    const top = document.createElement('div')
    top.className = 'ticket-card-top'

    const left = document.createElement('div')
    const title = document.createElement('div')
    title.className = 'ticket-title'
    title.textContent = `${ticketRef(ticket)} — ${ticket.title}`
    left.appendChild(title)

    const meta = document.createElement('div')
    meta.className = 'ticket-meta'
    meta.textContent = [
      formatDateTime(ticket.created_at),
      ticket.company, ticket.department, ticket.category, ticket.office,
    ].filter(Boolean).join(' · ')
    left.appendChild(meta)

    top.appendChild(left)

    const badge = document.createElement('span')
    badge.className = 'status-badge ' + statusClass(ticket.status)
    badge.textContent = ticket.status
    top.appendChild(badge)

    li.appendChild(top)

    if (ticket.description) {
      const desc = document.createElement('div')
      desc.className = 'ticket-desc'
      desc.textContent = ticket.description
      li.appendChild(desc)
    }

    if (!adminMode && ticket.solution) {
      const sol = document.createElement('div')
      sol.className = 'ticket-solution'
      sol.textContent = 'Solution: ' + ticket.solution
      li.appendChild(sol)
    }

    if (adminMode) {
      const controls = document.createElement('div')
      controls.className = 'admin-controls'

      const statusSelect = document.createElement('select')
      ;['Open', 'In Progress', 'Resolved'].forEach((s) => {
        const opt = document.createElement('option')
        opt.value = s
        opt.textContent = s
        opt.selected = s === ticket.status
        statusSelect.appendChild(opt)
      })

      const solutionInput = document.createElement('textarea')
      solutionInput.rows = 1
      solutionInput.placeholder = 'Solution / notes...'
      solutionInput.value = ticket.solution || ''

      const saveBtn = document.createElement('button')
      saveBtn.textContent = 'Save'
      saveBtn.addEventListener('click', () => updateTicket(ticket.id, statusSelect.value, solutionInput.value))

      controls.append(statusSelect, solutionInput, saveBtn)
      li.appendChild(controls)
    }

    listEl.appendChild(li)
  })
}

async function updateTicket(id, status, solution) {
  const fields = { status, solution, updated_at: nowIso() }
  if (status === 'Resolved') fields.resolved_at = nowIso()

  const { error } = await supabase.from('tickets').update(fields).eq('id', id)
  if (error) {
    alert('Could not update ticket: ' + error.message)
    return
  }
  loadAdminTickets()
}
