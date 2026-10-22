"""Tests fonctionnels sans appel réseau ni clé API. python -m unittest -v"""
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch

TEMP = tempfile.TemporaryDirectory()
os.environ['FLASKGPT_DATA_DIR'] = TEMP.name
import app as module
from werkzeug.datastructures import FileStorage


class Stream:
    def __init__(self, chunks): self.chunks = chunks
    def __enter__(self): return iter(self.chunks)
    def __exit__(self, *args): pass


class FakeClient:
    calls = []
    def __enter__(self): return self
    def __exit__(self, *args): pass
    @property
    def chat(self): return self
    @property
    def completions(self): return self
    def create(self, **kwargs):
        self.calls.append(kwargs)
        usage = NS(prompt_tokens=30, completion_tokens=10, total_tokens=40)
        if kwargs.get('stream'):
            return Stream([NS(usage=None, choices=[NS(delta=NS(content='Réponse vérifiée [S1:L1].'), finish_reason=None)]),
                           NS(usage=None, choices=[NS(delta=NS(content=''),finish_reason='stop')]), NS(choices=[],usage=usage)])
        return NS(usage=usage,choices=[NS(finish_reason='stop',message=NS(content='Résumé : décision et prochaines étapes.'))])


class AppTests(unittest.TestCase):
    def setUp(self):
        module.app.config.update(TESTING=True)
        with module.db() as c:
            c.execute('DELETE FROM conversations')
        self.client = module.app.test_client()
        self.client.get('/')
        with self.client.session_transaction() as s:
            self.headers = {'X-CSRF-Token':s['csrf']}
        self.cid = self.post('/api/conversations',{'domain':'donnees'}).json['id']
        FakeClient.calls.clear()

    def post(self,path,data=None,**kw):
        return self.client.post(path,json=data,headers=self.headers,**kw)

    def snap(self): return self.client.get('/api/conversations/'+self.cid).json

    def upload(self, data=b'age,nom\n20,A\n20,A\n,B\nabc,C\n', name='test.csv'):
        return self.client.post(f'/api/conversations/{self.cid}/sources',data={'file':(io.BytesIO(data),name)},headers=self.headers)

    def chat(self, **kwargs):
        with patch.object(module,'client',return_value=FakeClient()):
            return self.post('/prompt',{'conversation_id':self.cid,'message':'Analyse age',**kwargs},buffered=True)

    def test_csrf_and_owner_isolation(self):
        self.assertEqual(self.client.post('/api/conversations',json={}).status_code,403)
        other=module.app.test_client()
        self.assertEqual(other.get('/api/conversations/'+self.cid).status_code,404)

    def test_domain_validation_and_update(self):
        path='/api/conversations/'+self.cid
        self.assertEqual(self.client.patch(path,json={'domain':'bad'},headers=self.headers).status_code,400)
        self.client.patch(path,json={'domain':'finance','specialty':'Audit'},headers=self.headers)
        self.chat()
        self.assertIn('Finance. Audit',FakeClient.calls[-1]['messages'][0]['content'])

    def test_stream_persistence_tokens_and_rating(self):
        response=self.chat()
        self.assertIn('event: done',response.text)
        conv=self.snap()
        self.assertEqual([m['role'] for m in conv['messages']],['user','assistant'])
        self.assertEqual(conv['runs'][0]['total_tokens'],40)
        mid=conv['messages'][1]['id']
        path=f'/api/conversations/{self.cid}/messages/{mid}/rating'
        self.assertEqual(self.client.patch(path,json={'rating':3},headers=self.headers).status_code,200)
        self.assertEqual(self.snap()['messages'][1]['rating'],3)
        self.assertEqual(self.client.patch(path,json={'rating':True},headers=self.headers).status_code,400)

    def test_source_quality_and_selected_context(self):
        response=self.upload()
        self.assertEqual(response.status_code,201,response.text)
        source=response.json['sources'][0]
        table=source['report']['tables'][0]
        self.assertEqual(table['duplicates'],1)
        self.assertEqual(table['missing'],1)
        self.chat(sources=[source['id']],count=2,mode='lignes')
        system=FakeClient.calls[-1]['messages'][0]['content']
        self.assertIn('PASSAGES FOURNIS',system)
        self.assertIn('INDICATEURS CALCULÉS',system)
        self.assertEqual(len(self.snap()['messages'][1]['sources']),2)
        self.chat(sources=[])
        self.assertNotIn('PASSAGES FOURNIS',FakeClient.calls[-1]['messages'][0]['content'])

    def test_rules_and_missing_column(self):
        sid=self.upload().json['sources'][0]['id']
        response=self.post(f'/api/conversations/{self.cid}/sources/{sid}/rules',{'rules':{'age':{'required':True,'min':21},'absente':{'required':True}}})
        results={r['column']:r for r in response.json['business_rules']['results']}
        self.assertEqual(results['age']['violations'],4)
        self.assertEqual(results['absente']['error'],'Colonne absente')

    def test_invalid_inputs_and_files(self):
        self.assertEqual(self.post('/prompt',{'conversation_id':self.cid,'message':''}).status_code,400)
        self.assertEqual(self.post('/prompt',{'conversation_id':self.cid,'message':'ok','sources':[999]}).status_code,400)
        self.assertEqual(self.upload(b'one,two\n1\n').status_code,400)
        self.assertEqual(self.upload(b'one,one\n1,2\n').status_code,400)
        self.assertEqual(self.upload(b'not sqlite', 'bad.db').status_code,400)

    def test_sqlite_import_and_fk(self):
        import sqlite3
        path=Path(TEMP.name)/'sample.sqlite'
        with sqlite3.connect(path) as c:
            c.executescript('DROP TABLE IF EXISTS child; DROP TABLE IF EXISTS parent; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(pid INTEGER REFERENCES parent(id)); INSERT INTO child VALUES(42);')
        response=self.upload(path.read_bytes(),'sample.db')
        self.assertEqual(response.status_code,201,response.text)
        self.assertEqual(response.json['sources'][0]['report']['foreign_key_violations'],1)

    def test_quota_error_no_partial_history(self):
        try:
            import httpx2 as httpx
        except ImportError:
            import httpx
        from openai import RateLimitError
        error=RateLimitError('quota',response=httpx.Response(429,request=httpx.Request('POST','https://example.test')),body={})
        with patch.object(module,'client',side_effect=error):
            response=self.post('/prompt',{'conversation_id':self.cid,'message':'bonjour'},buffered=True)
        self.assertIn('Quota',response.text)
        conv=self.snap()
        self.assertEqual(conv['messages'],[])
        self.assertEqual(conv['runs'][0]['status'],'error')
        self.assertIsNone(conv['runs'][0]['total_tokens'])
        self.assertEqual(conv['busy'],0)

    def test_empty_api_key(self):
        with patch.dict(os.environ,{'GROQ_API_KEY':'','OPENAI_API_KEY':''}):
            response=self.post('/prompt',{'conversation_id':self.cid,'message':'bonjour'},buffered=True)
        self.assertIn('Clé API absente',response.text)
        self.assertEqual(self.snap()['busy'],0)

    def test_provider_errors_are_readable(self):
        from openai import AuthenticationError, APIConnectionError, APITimeoutError
        try:
            import httpx2 as httpx
        except ImportError:
            import httpx
        req=httpx.Request('POST','https://example.test')
        cases=[(AuthenticationError('invalid',response=httpx.Response(401,request=req),body={}), 'Clé API invalide'),
               (APIConnectionError(request=req),'Connexion'),(APITimeoutError(request=req),'trop de temps')]
        for exc, expected in cases:
            with self.subTest(expected=expected), patch.object(module,'client',side_effect=exc):
                response=self.post('/prompt',{'conversation_id':self.cid,'message':'test'},buffered=True)
                self.assertIn(expected,response.text)
                self.assertEqual(self.snap()['messages'],[])

    def test_partial_stream_not_saved(self):
        class Broken(FakeClient):
            def create(self,**kw):
                return Stream([NS(usage=None,choices=[NS(delta=NS(content='Partiel'),finish_reason=None)])])
        with patch.object(module,'client',return_value=Broken()):
            response=self.post('/prompt',{'conversation_id':self.cid,'message':'test'},buffered=True)
        self.assertIn('event: error',response.text)
        self.assertEqual(self.snap()['messages'],[])
        self.assertEqual(self.snap()['busy'],0)

    def test_exports_summary_and_deletion(self):
        self.chat()
        for fmt in ('txt','json','pdf'):
            response=self.client.get(f'/api/conversations/{self.cid}/export/{fmt}')
            self.assertEqual(response.status_code,200,response.text[:100] if fmt!='pdf' else '')
            if fmt=='pdf':
                self.assertTrue(response.data.startswith(b'%PDF'))
                from pypdf import PdfReader
                self.assertIn('Réponse vérifiée',PdfReader(io.BytesIO(response.data)).pages[0].extract_text())
        with patch.object(module,'client',return_value=FakeClient()):
            response=self.post(f'/api/conversations/{self.cid}/summary')
        self.assertTrue(response.data.startswith(b'%PDF'))
        self.assertEqual(self.snap()['runs'][-1]['kind'],'summary')
        response=self.client.delete('/api/conversations/'+self.cid,headers=self.headers)
        self.assertEqual(response.status_code,200)
        with module.db() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM messages').fetchone()[0],0)
            self.assertEqual(c.execute('SELECT count(*) FROM runs').fetchone()[0],0)

    def test_busy_blocks_mutations(self):
        with module.db() as c: c.execute('UPDATE conversations SET busy=1 WHERE id=?',(self.cid,))
        self.assertEqual(self.client.delete('/api/conversations/'+self.cid,headers=self.headers).status_code,409)
        self.assertEqual(self.post('/prompt',{'conversation_id':self.cid,'message':'hi'}).status_code,409)

    def test_source_text_is_not_html_and_paragraph_selection(self):
        response=self.upload('Premier paragraphe\nligne deux\n\nDeuxième paragraphe'.encode(),'source.txt')
        sid=response.json['sources'][0]['id']
        self.chat(sources=[sid],mode='paragraphes',count=1)
        self.assertEqual(len(self.snap()['messages'][1]['sources']),1)


if __name__=='__main__':
    unittest.main()
