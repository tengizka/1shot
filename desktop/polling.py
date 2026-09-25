"""Bounded polling: failures or stuck commands must not create a request storm."""
import time

class PollBudget:
    def __init__(self,clock=time.monotonic):
        self.clock=clock;self.failures=0;self.signature=();self.fast_until=0
    def interval(self,rows=(),failed=False):
        if failed:
            self.failures=min(4,self.failures+1)
            return min(60,10*2**self.failures)
        self.failures=0
        signature=tuple(sorted((str(b['id']),b['status']) for b in rows if b.get('status') in ('checkin_pending','cancel_requested','release_requested')))
        if signature!=self.signature:
            self.signature=signature;self.fast_until=self.clock()+30 if signature else 0
        return 2 if signature and self.clock()<self.fast_until else 10
