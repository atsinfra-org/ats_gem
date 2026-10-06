/* Dev/ops helper: enqueue one job through the real producer and print its result. Usage (inside the api container):
 *   node enqueue-job.cjs <jobName> '<json payload>' [jobId]
 * Payloads are validated by the job registry, exactly like production enqueues. */
const { NestFactory } = require('@nestjs/core');
const { CliModule } = require('./dist/cli.module');
const { QueueProducer } = require('./dist/queues/queue.producer');

(async () => {
  const [name, payloadJson = '{}', jobId] = process.argv.slice(2);
  if (!name) throw new Error('usage: enqueue-job.cjs <jobName> [payloadJson] [jobId]');
  const app = await NestFactory.createApplicationContext(CliModule, { logger: false });
  const producer = app.get(QueueProducer);
  const job = await producer.enqueue(name, JSON.parse(payloadJson), { origin: 'cli', jobId: jobId ?? `cli-${name}-${Date.now()}` });
  const q = producer.queue(job.queue);
  for (let i = 0; i < 120; i++) {
    const j = await q.getJob(job.id);
    if (j && (await j.isCompleted())) {
      console.log(JSON.stringify({ status: 'completed', result: j.returnvalue }));
      break;
    }
    if (j && (await j.isFailed())) {
      console.log(JSON.stringify({ status: 'failed', reason: String(j.failedReason).slice(0, 200) }));
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await app.close();
})().catch((e) => {
  console.error(String(e).slice(0, 300));
  process.exit(1);
});
