import Header from './components/Header'
import Hero from './components/Hero'
import Logos from './components/Logos'
import Services from './components/Services'
import QuickHelp from './components/QuickHelp'
import Process from './components/Process'
import About from './components/About'
import Faq from './components/Faq'
import CtaFinal from './components/CtaFinal'
import Contact from './components/Contact'
import Footer from './components/Footer'
import FloatingButtons from './components/FloatingButtons'

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Logos />
        <Services />
        <QuickHelp />
        <Process />
        <About />
        <Faq />
        <CtaFinal />
        <Contact />
      </main>
      <Footer />
      <FloatingButtons />
    </>
  )
}
