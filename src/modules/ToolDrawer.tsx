import { useEffect, useMemo, useState } from 'react';
import { bus } from '../core/bus';
import { useAppStore } from '../core/store';
import { sendEmail, type EmailRequest, type EmailTransportConfig } from '../lib/api';

type WorkflowField = {
  name: string;
  label: string;
  type?: 'text' | 'textarea';
  required?: boolean;
};

type WorkflowDefinition = {
  id: string;
  name: string;
  description?: string;
  policy: string;
  template: string;
  fields: WorkflowField[];
};

type WorkflowModule = { default: WorkflowDefinition } | WorkflowDefinition;

const workflowFiles = import.meta.glob('../workflows/*.json', { eager: true }) as Record<string, WorkflowModule>;

export const ToolDrawer = ({ id }: { id: string }) => {
  const lastResponse = useAppStore((state) => state.stream.history.at(-1)?.text ?? '');
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const setModuleFunctions = useAppStore((state) => state.setModuleFunctions);

  const workflows = useMemo(() => {
    return Object.values(workflowFiles)
      .map((entry) => ('default' in entry ? entry.default : entry))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [transport, setTransport] = useState<EmailTransportConfig>({
    host: '',
    port: 587,
    username: '',
    from: '',
    useTls: true,
    password: undefined,
    storePassword: false,
  });
  const [consent, setConsent] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowDefinition | null>(null);
  const [workflowValues, setWorkflowValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!emailBody && lastResponse) {
      setEmailBody(lastResponse);
    }
  }, [lastResponse]);

  useEffect(() => {
    setModuleFunctions(id, {
      'tool.email.prefill': (payload: { to?: string; subject?: string; body?: string }) => {
        if (payload.to) setEmailTo(payload.to);
        if (payload.subject) setEmailSubject(payload.subject);
        if (payload.body) setEmailBody(payload.body);
      },
      'tool.workflow.open': (workflowId: string) => {
        const wf = workflows.find((w) => w.id === workflowId);
        if (wf) {
          setSelectedWorkflow(wf);
          setWorkflowValues(Object.fromEntries(wf.fields.map((field) => [field.name, ''])));
        }
      },
      clear: () => {
        setEmailTo('');
        setEmailSubject('');
        setEmailBody('');
      },
    });
  }, [id, setModuleFunctions, workflows]);

  const openWorkflow = (workflow: WorkflowDefinition) => {
    setSelectedWorkflow(workflow);
    setWorkflowValues(Object.fromEntries(workflow.fields.map((field) => [field.name, ''])));
  };

  const applyWorkflow = () => {
    if (!selectedWorkflow) return;
    const composed = composeWorkflow(selectedWorkflow, workflowValues);
    bus.emit('composer.set', composed);
    bus.emit('prompt.send', { text: composed });
    setSelectedWorkflow(null);
  };

  const handleSendEmail = async () => {
    if (!emailTo || !emailSubject || !emailBody) {
      setStatusMessage('Fill in To, Subject, and Body before sending.');
      return;
    }
    if (!consent) {
      setStatusMessage('Email sending requires explicit approval.');
      return;
    }
    setSending(true);
    setStatusMessage(null);
    const request: EmailRequest = {
      to: emailTo,
      subject: emailSubject,
      body: emailBody,
      approve: consent,
      sessionId: currentSessionId,
      transport,
    };
    try {
      const result = await sendEmail(request);
      setStatusMessage(`Email run ${result.runId} sent (${result.status}).`);
      setPreviewing(false);
    } catch (error) {
      setStatusMessage(`Email error: ${(error as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  const workflowList = workflows.map((workflow) => (
    <button
      key={workflow.id}
      className="w-full rounded-lg border border-[var(--surface-border)] bg-transparent px-3 py-2 text-left text-sm hover:border-[var(--accent)] hover:text-[var(--accent)]"
      onClick={() => openWorkflow(workflow)}
      type="button"
    >
      <div className="font-semibold">{workflow.name}</div>
      {workflow.description ? (
        <div className="text-xs text-[var(--muted-foreground)]">{workflow.description}</div>
      ) : null}
    </button>
  ));

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[var(--surface-border)] px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--muted-foreground)]">Tools</h2>
        <p className="text-xs text-[var(--muted-foreground)]">Send mail, run workflows, orchestrate actions</p>
      </header>
      <div className="flex-1 space-y-4 overflow-auto px-4 py-3 scrollbar-thin">
        <section className="space-y-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)]/60 p-4 shadow-sm">
          <header className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Email Tool</h3>
              <p className="text-xs text-[var(--muted-foreground)]">Preview then send via configured SMTP transport.</p>
            </div>
            <button
              type="button"
              className="text-xs text-[var(--accent)]"
              onClick={() => setPreviewing((prev) => !prev)}
            >
              {previewing ? 'Hide Preview' : 'Preview → Send'}
            </button>
          </header>
          <div className="space-y-2 text-sm">
            <label className="flex flex-col">
              <span className="text-xs text-[var(--muted-foreground)]">To</span>
              <input
                className="rounded border border-[var(--surface-border)] bg-transparent px-2 py-1"
                value={emailTo}
                onChange={(event) => setEmailTo(event.target.value)}
                placeholder="recipient@example.com"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-[var(--muted-foreground)]">Subject</span>
              <input
                className="rounded border border-[var(--surface-border)] bg-transparent px-2 py-1"
                value={emailSubject}
                onChange={(event) => setEmailSubject(event.target.value)}
                placeholder="Codex Update"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-[var(--muted-foreground)]">Body</span>
              <textarea
                className="min-h-[120px] rounded border border-[var(--surface-border)] bg-transparent px-2 py-1 text-sm"
                value={emailBody}
                onChange={(event) => setEmailBody(event.target.value)}
              />
            </label>
            <details className="rounded border border-dashed border-[var(--surface-border)] p-3 text-xs">
              <summary className="cursor-pointer font-semibold">Transport Settings</summary>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <label className="flex flex-col">
                  <span className="text-xs text-[var(--muted-foreground)]">SMTP Host</span>
                  <input
                    className="rounded border border-[var(--surface-border)] bg-transparent px-2 py-1"
                    value={transport.host}
                    onChange={(event) => setTransport((prev) => ({ ...prev, host: event.target.value }))}
                  />
                </label>
                <label className="flex flex-col">
                  <span className="text-xs text-[var(--muted-foreground)]">Port</span>
                  <input
                    type="number"
                    className="rounded border border-[var(--surface-border)] bg-transparent px-2 py-1"
                    value={transport.port}
                    onChange={(event) =>
                      setTransport((prev) => ({ ...prev, port: Number(event.target.value) || 0 }))
                    }
                  />
                </label>
                <label className="flex flex-col">
                  <span className="text-xs text-[var(--muted-foreground)]">Username</span>
                  <input
                    className="rounded border border-[var(--surface-border)] bg-transparent px-2 py-1"
                    value={transport.username}
                    onChange={(event) => setTransport((prev) => ({ ...prev, username: event.target.value }))}
                  />
                </label>
                <label className="flex flex-col">
                  <span className="text-xs text-[var(--muted-foreground)]">From</span>
                  <input
                    className="rounded border border-[var(--surface-border)] bg-transparent px-2 py-1"
                    value={transport.from}
                    onChange={(event) => setTransport((prev) => ({ ...prev, from: event.target.value }))}
                  />
                </label>
                <label className="flex flex-col">
                  <span className="text-xs text-[var(--muted-foreground)]">Password (optional)</span>
                  <input
                    type="password"
                    className="rounded border border-[var(--surface-border)] bg-transparent px-2 py-1"
                    value={transport.password ?? ''}
                    onChange={(event) =>
                      setTransport((prev) => ({ ...prev, password: event.target.value || undefined }))
                    }
                  />
                </label>
                <label className="mt-4 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={transport.useTls}
                    onChange={(event) => setTransport((prev) => ({ ...prev, useTls: event.target.checked }))}
                  />
                  <span>Use TLS</span>
                </label>
                <label className="mt-4 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={transport.storePassword ?? false}
                    onChange={(event) =>
                      setTransport((prev) => ({ ...prev, storePassword: event.target.checked }))
                    }
                  />
                  <span>Store password via keyring</span>
                </label>
              </div>
            </details>
            <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span>I confirm this email is approved for sending.</span>
            </label>
            {previewing ? (
              <div className="rounded border border-[var(--surface-border)] bg-[var(--muted)]/20 p-3 text-sm">
                <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-foreground)]">Preview</h4>
                <dl className="mt-2 space-y-1">
                  <div className="flex justify-between text-xs text-[var(--muted-foreground)]">
                    <span>To</span>
                    <span>{emailTo || '—'}</span>
                  </div>
                  <div className="flex justify-between text-xs text-[var(--muted-foreground)]">
                    <span>Subject</span>
                    <span>{emailSubject || '—'}</span>
                  </div>
                </dl>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-[var(--foreground)]">{emailBody}</pre>
                <button
                  type="button"
                  className="mt-3 w-full rounded bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--accent-foreground)] disabled:opacity-40"
                  onClick={handleSendEmail}
                  disabled={sending}
                >
                  {sending ? 'Sending…' : 'Send Email'}
                </button>
              </div>
            ) : null}
            {statusMessage ? (
              <p className="text-xs text-[var(--muted-foreground)]">{statusMessage}</p>
            ) : null}
          </div>
        </section>

        <section className="space-y-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)]/60 p-4 shadow-sm">
          <header>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Workflows</h3>
            <p className="text-xs text-[var(--muted-foreground)]">Trigger structured prompts from JSON recipes.</p>
          </header>
          <div className="space-y-2">{workflowList}</div>
          {selectedWorkflow ? (
            <div className="mt-3 space-y-2 rounded-lg border border-[var(--surface-border)] bg-[var(--muted)]/10 p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold">{selectedWorkflow.name}</h4>
                  {selectedWorkflow.description ? (
                    <p className="text-xs text-[var(--muted-foreground)]">{selectedWorkflow.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="text-xs text-[var(--muted-foreground)]"
                  onClick={() => setSelectedWorkflow(null)}
                >
                  Cancel
                </button>
              </div>
              {selectedWorkflow.fields.map((field) => (
                <label key={field.name} className="flex flex-col">
                  <span className="text-xs text-[var(--muted-foreground)]">{field.label}</span>
                  {field.type === 'textarea' ? (
                    <textarea
                      className="rounded border border-[var(--surface-border)] bg-transparent px-2 py-1"
                      value={workflowValues[field.name] ?? ''}
                      onChange={(event) =>
                        setWorkflowValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                      }
                      required={field.required}
                    />
                  ) : (
                    <input
                      className="rounded border border-[var(--surface-border)] bg-transparent px-2 py-1"
                      value={workflowValues[field.name] ?? ''}
                      onChange={(event) =>
                        setWorkflowValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                      }
                      required={field.required}
                    />
                  )}
                </label>
              ))}
              <button
                type="button"
                className="w-full rounded bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--accent-foreground)]"
                onClick={applyWorkflow}
              >
                Run Workflow
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
};

function composeWorkflow(workflow: WorkflowDefinition, values: Record<string, string>): string {
  const policy = workflow.policy.trim();
  const template = workflow.template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
  return `${policy}\n\n${template}`.trim();
}
