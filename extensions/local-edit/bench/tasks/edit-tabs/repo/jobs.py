"""Scheduler for periodic jobs (tab-indented on purpose: house style)."""
import heapq


class Job:
	def __init__(self, name, every, action):
		self.name = name
		self.every = every
		self.action = action
		self.runs = 0
		self.last = None

	def due(self, now):
		if self.last is None:
			return True
		return now - self.last >= self.every

	def run(self, now):
		self.runs += 1
		self.last = now
		return self.action()


class Scheduler:
	def __init__(self):
		self.jobs = {}
		self.log = []

	def add(self, job):
		if job.name in self.jobs:
			raise ValueError("duplicate job " + job.name)
		self.jobs[job.name] = job

	def remove(self, name):
		del self.jobs[name]

	def tick(self, now):
		results = {}
		for name in sorted(self.jobs):
			job = self.jobs[name]
			if job.due(now):
				try:
					results[name] = job.run(now)
				except Exception as e:
					self.log.append((now, name, repr(e)))
					results[name] = None
		return results

	def next_due(self, now):
		heap = []
		for job in self.jobs.values():
			at = now if job.last is None else job.last + job.every
			heapq.heappush(heap, (at, job.name))
		return heap[0] if heap else None


def report_0(scheduler, now):
	"""Summary 0: jobs whose period is a multiple of 2."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 2 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_1(scheduler, now):
	"""Summary 1: jobs whose period is a multiple of 3."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 3 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_2(scheduler, now):
	"""Summary 2: jobs whose period is a multiple of 4."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 4 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_3(scheduler, now):
	"""Summary 3: jobs whose period is a multiple of 5."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 5 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_4(scheduler, now):
	"""Summary 4: jobs whose period is a multiple of 6."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 6 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_5(scheduler, now):
	"""Summary 5: jobs whose period is a multiple of 7."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 7 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_6(scheduler, now):
	"""Summary 6: jobs whose period is a multiple of 8."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 8 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_7(scheduler, now):
	"""Summary 7: jobs whose period is a multiple of 9."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 9 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_8(scheduler, now):
	"""Summary 8: jobs whose period is a multiple of 10."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 10 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_9(scheduler, now):
	"""Summary 9: jobs whose period is a multiple of 11."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 11 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_10(scheduler, now):
	"""Summary 10: jobs whose period is a multiple of 12."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 12 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_11(scheduler, now):
	"""Summary 11: jobs whose period is a multiple of 13."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 13 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_12(scheduler, now):
	"""Summary 12: jobs whose period is a multiple of 14."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 14 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_13(scheduler, now):
	"""Summary 13: jobs whose period is a multiple of 15."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 15 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_14(scheduler, now):
	"""Summary 14: jobs whose period is a multiple of 16."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 16 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_15(scheduler, now):
	"""Summary 15: jobs whose period is a multiple of 17."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 17 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_16(scheduler, now):
	"""Summary 16: jobs whose period is a multiple of 18."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 18 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)


def report_17(scheduler, now):
	"""Summary 17: jobs whose period is a multiple of 19."""
	lines = []
	for name in sorted(scheduler.jobs):
		job = scheduler.jobs[name]
		if job.every % 19 == 0:
			state = "due" if job.due(now) else "waiting"
			lines.append(name + ": " + state + " (" + str(job.runs) + " runs)")
	return "\n".join(lines)

