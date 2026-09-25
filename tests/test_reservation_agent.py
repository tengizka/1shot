import ast
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import Mock

class NetworkError(Exception): pass

class GizmoReservationTests(TestCase):
    def setUp(self):
        names = {'GizmoReservationUncertain','parse_gizmo_date','infer_reservation_unit_seconds',
                 'build_reservation_params','validate_gizmo_booking_user','create_gizmo_reservation','get_reservation_unit_seconds',
                 'save_reservation_journal','load_reservation_journal','process_pending_reservations'}
        tree = ast.parse(Path('agent.py').read_text())
        nodes = [n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in names]
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.put = Mock(return_value=Mock(status_code=200))
        self.get = Mock()
        self.ns = dict(datetime=datetime,timedelta=timedelta,timezone=timezone,Path=Path,json=json,os=os,
            log=Mock(),gizmo_put=self.put,gizmo_get=self.get,gizmo_reservation_error_detail=lambda s:s,
            requests=SimpleNamespace(exceptions=SimpleNamespace(RequestException=NetworkError)),
            _reservation_unit_seconds=None,RESERVATION_JOURNAL=Path(self.temp.name)/'journal.json')
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'agent.py','exec'),self.ns)
        self.start = datetime.now(timezone.utc)-timedelta(minutes=20)
        self.params = self.ns['build_reservation_params']('11',42,self.start.isoformat(),60,'request-id')
        self.actual = {'id':123,'hosts':[{'hostId':11}],'users':[{'userId':42}],'userId':42,
                      'date':self.start.isoformat(),'endDate':(self.start+timedelta(minutes=60)).isoformat()}
        self.member = {'id':42,'isDeleted':False}
        def get(path, **kwargs):
            response = Mock(status_code=200)
            response.json.return_value=self.member if path.startswith('users/') else self.actual
            return response
        self.get.side_effect = get
    def test_method_query_and_reference_contract(self):
        spec=json.loads(Path('docs.json').read_text())
        endpoint=spec['paths']['/api/reservations']['put']
        self.assertTrue(all(p['in']=='query' for p in endpoint['parameters']))
        self.assertIn('hostId',spec['components']['schemas']['ReservationHostParameter']['required'])
        self.put.return_value.json.return_value=123
        self.assertEqual(self.ns['create_gizmo_reservation'](self.params,60),'123')
        self.assertEqual(self.put.call_count,2)
        self.put.assert_any_call('reservations',params=self.params)
        self.put.assert_any_call('reservations/123/users/42')
        self.assertNotIn('json',self.put.call_args.kwargs)
        self.assertEqual(self.params['Hosts[0].HostId'],11)
        self.assertEqual(self.params['UserId'],42)
        self.assertNotIn('Users[0].UserId',self.params)
        self.assertNotIn('Hosts[0].PreferedUserId',self.params)
        self.assertIn('put',spec['paths']['/api/reservations/{reservationId}/users/{userId}'])
        self.assertEqual(self.params['Duration'],60)
        self.assertEqual(self.ns['parse_gizmo_date'](self.params['Date']),self.start)
    def test_scalar_and_wrapped_ids(self):
        for response in (123,{'result':123},{'result':{'id':123}}):
            self.put.return_value.json.return_value=response
            self.assertEqual(self.ns['create_gizmo_reservation'](self.params,60),'123')
    def test_duration_unit_inferred_not_guessed(self):
        for duration,unit in ((60,60),(3600,1)):
            sample={**self.actual,'duration':duration}
            self.assertEqual(self.ns['infer_reservation_unit_seconds']([sample]),unit)
        with self.assertRaises(ValueError): self.ns['infer_reservation_unit_seconds']([])
        with self.assertRaises(ValueError): self.ns['infer_reservation_unit_seconds']([{**self.actual,'duration':60},{**self.actual,'duration':3600}])
    def test_expired_or_missing_account_rejected(self):
        with self.assertRaises(ValueError): self.ns['build_reservation_params']('11',42,'2020-01-01T00:00:00Z',60,'r')
        with self.assertRaises(ValueError): self.ns['build_reservation_params']('11',None,self.start.isoformat(),60,'r')
        self.put.assert_not_called()
    def test_rejection_body_preserved(self):
        self.put.return_value.status_code=400
        self.put.return_value.text='Hosts: invalid hostId'
        with self.assertRaisesRegex(ValueError,'PUT.*400.*hostId'):
            self.ns['create_gizmo_reservation'](self.params,60)
        self.get.assert_called_once_with("users/42")
    def test_readback_failure_and_timeout_are_uncertain(self):
        uncertain=self.ns['GizmoReservationUncertain']
        self.put.return_value.json.return_value=123
        self.actual['endDate']=(self.start+timedelta(seconds=60)).isoformat()
        with self.assertRaises(uncertain) as error:self.ns['create_gizmo_reservation'](self.params,60)
        self.assertEqual(error.exception.reservation_id,'123')
        self.put.side_effect=NetworkError()
        with self.assertRaises(uncertain):self.ns['create_gizmo_reservation'](self.params,60)
    def test_uncertain_or_confirmed_journal_never_replays_write(self):
        pending=[{'id':'r','host_id':'11','gizmo_user_id':42,'created_at':self.start.isoformat()}]
        response=Mock();response.json.return_value={'reservations':pending}
        self.ns.update(get_from_supabase=Mock(return_value=response),fetch_gizmo_hosts=Mock(return_value=[{'id':11,'number':11}]),
                       get_reservation_unit_seconds=Mock(return_value=60),report_reservation=Mock())
        for state in ({'status':'uncertain'},{'status':'confirmed','gizmo_reservation_id':'123'}):
            self.ns['save_reservation_journal']({'r':state})
            self.ns['process_pending_reservations']()
        self.put.assert_not_called()
        self.ns['report_reservation'].assert_called_once_with('r','confirmed',gizmo_reservation_id='123')
    def test_journal_written_before_request_and_confirmed_after_verification(self):
        response=Mock();response.json.return_value={'reservations':[{'id':'r','host_id':'11','gizmo_user_id':42,'created_at':self.start.isoformat()}]}
        self.ns.update(get_from_supabase=Mock(return_value=response),fetch_gizmo_hosts=Mock(return_value=[{'id':11,'number':11}]),
                       get_reservation_unit_seconds=Mock(return_value=60),report_reservation=Mock())
        def put(*args,**kwargs):
            self.assertEqual(self.ns['load_reservation_journal']()['r']['status'],'uncertain')
            result=Mock(status_code=200);result.json.return_value=123;return result
        self.put.side_effect=put
        self.ns['process_pending_reservations']()
        self.assertEqual(self.ns['load_reservation_journal']()['r']['status'],'confirmed')
        self.ns['process_pending_reservations']()
        self.assertEqual(self.put.call_count,2)

    def test_deleted_or_wrong_member_never_creates_reservation(self):
        for member in ({'id':0},{'id':42,'isDeleted':True},{'isError':True}):
            self.member=member
            with self.assertRaises(ValueError):self.ns['create_gizmo_reservation'](self.params,60)
        self.put.assert_not_called()
    def test_user_attachment_failure_preserves_created_id(self):
        created=Mock(status_code=200);created.json.return_value=123
        failed=Mock(status_code=400,text='UserMember not found')
        self.put.side_effect=[created,failed]
        with self.assertRaises(self.ns['GizmoReservationUncertain']) as error:
            self.ns['create_gizmo_reservation'](self.params,60)
        self.assertEqual(error.exception.reservation_id,'123')
        self.assertIn('/users/42',str(error.exception))
        self.assertEqual(self.put.call_count,2)

    def test_ps5_queue_entry_is_rejected_without_gizmo_write(self):
        response=Mock();response.json.return_value={'reservations':[{'id':'ps5-request','host_id':'1','gizmo_user_id':42,'created_at':self.start.isoformat()}]}
        self.ns.update(get_from_supabase=Mock(return_value=response),fetch_gizmo_hosts=Mock(return_value=[{'id':77,'number':1}]),
                       get_reservation_unit_seconds=Mock(return_value=60),report_reservation=Mock())
        self.ns['process_pending_reservations']()
        self.put.assert_not_called()
        self.assertEqual(self.ns['report_reservation'].call_args.args[1],'failed')
        self.assertIn('ps5_phone_only',self.ns['report_reservation'].call_args.kwargs['error_message'])

if __name__=='__main__':main()
